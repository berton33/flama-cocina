-- FLAMA · Cocina — esquema propio dentro del proyecto Supabase "Marvel Compartido".
-- Solo CREA objetos nuevos: el esquema flama (no expuesto por la API) y funciones
-- públicas con prefijo flama_. No modifica nada existente.

create schema if not exists flama;
revoke all on schema flama from public;

create table if not exists flama.config (
  clave text primary key,
  valor text
);

create table if not exists flama.planes (
  fecha date primary key,
  nota text,
  actualizado timestamptz not null default now()
);

create table if not exists flama.plan_items (
  id bigint generated always as identity primary key,
  fecha date not null references flama.planes(fecha) on delete cascade,
  produccion_id text not null,
  cantidad numeric not null check (cantidad > 0),
  unidad text not null,
  orden int not null default 0,
  hecho boolean not null default false,
  hecho_at timestamptz,
  unique (fecha, produccion_id)
);

create table if not exists flama.insumos (
  id text primary key,
  nombre text not null,
  rubro text not null,
  unidad text not null,
  minimo numeric check (minimo is null or minimo >= 0),
  orden int not null,
  activo boolean not null default true
);

create table if not exists flama.conteos (
  id bigint generated always as identity primary key,
  fecha date not null,
  insumo_id text not null references flama.insumos(id),
  cantidad numeric not null check (cantidad >= 0),
  actualizado timestamptz not null default now(),
  unique (fecha, insumo_id)
);
create index if not exists conteos_insumo_fecha on flama.conteos (insumo_id, fecha desc);

-- ---------- PIN ----------
create or replace function flama.pin_ok(p_pin text) returns boolean
language plpgsql security definer set search_path = flama, extensions as $$
declare h text;
begin
  select valor into h from flama.config where clave = 'pin_hash';
  if h is null or p_pin is null or extensions.crypt(p_pin, h) <> h then
    perform pg_sleep(0.7);
    return false;
  end if;
  return true;
end $$;

create or replace function public.flama_pin_estado() returns json
language sql security definer set search_path = flama as $$
  select json_build_object('definido', exists (select 1 from flama.config where clave = 'pin_hash' and valor is not null));
$$;

create or replace function public.flama_pin_set(p_actual text, p_nuevo text) returns json
language plpgsql security definer set search_path = flama, extensions as $$
declare existe boolean;
begin
  select exists (select 1 from flama.config where clave = 'pin_hash' and valor is not null) into existe;
  if existe and not flama.pin_ok(p_actual) then raise exception 'PIN_INCORRECTO'; end if;
  if p_nuevo is null or length(p_nuevo) < 4 or length(p_nuevo) > 32 then raise exception 'PIN_INVALIDO'; end if;
  insert into flama.config (clave, valor) values ('pin_hash', extensions.crypt(p_nuevo, extensions.gen_salt('bf')))
  on conflict (clave) do update set valor = excluded.valor;
  return json_build_object('ok', true);
end $$;

-- ---------- Producción del día ----------
create or replace function public.flama_plan_get(p_fecha date) returns json
language sql security definer set search_path = flama as $$
  select json_build_object(
    'fecha', p_fecha,
    'nota', (select nota from flama.planes where fecha = p_fecha),
    'actualizado', (select actualizado from flama.planes where fecha = p_fecha),
    'items', coalesce((
      select json_agg(json_build_object(
        'id', id, 'produccion_id', produccion_id, 'cantidad', cantidad, 'unidad', unidad,
        'orden', orden, 'hecho', hecho, 'hecho_at', hecho_at) order by orden, id)
      from flama.plan_items where fecha = p_fecha), '[]'::json)
  );
$$;

create or replace function public.flama_plan_guardar(p_pin text, p_fecha date, p_nota text, p_items json) returns json
language plpgsql security definer set search_path = flama as $$
declare it json; ids text[] := '{}';
begin
  if not flama.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  insert into flama.planes (fecha, nota, actualizado) values (p_fecha, nullif(trim(coalesce(p_nota, '')), ''), now())
  on conflict (fecha) do update set nota = excluded.nota, actualizado = now();
  for it in select * from json_array_elements(coalesce(p_items, '[]'::json)) loop
    ids := ids || (it->>'produccion_id');
    insert into flama.plan_items (fecha, produccion_id, cantidad, unidad, orden)
    values (p_fecha, it->>'produccion_id', (it->>'cantidad')::numeric, it->>'unidad', coalesce((it->>'orden')::int, 0))
    on conflict (fecha, produccion_id) do update
      set cantidad = excluded.cantidad, unidad = excluded.unidad, orden = excluded.orden;
  end loop;
  delete from flama.plan_items where fecha = p_fecha and not (produccion_id = any (ids));
  if cardinality(ids) = 0 and nullif(trim(coalesce(p_nota, '')), '') is null then
    delete from flama.planes where fecha = p_fecha;
  end if;
  return public.flama_plan_get(p_fecha);
end $$;

create or replace function public.flama_item_marcar(p_id bigint, p_hecho boolean) returns json
language plpgsql security definer set search_path = flama as $$
declare f date;
begin
  update flama.plan_items set hecho = p_hecho, hecho_at = case when p_hecho then now() else null end
  where id = p_id returning fecha into f;
  if f is null then raise exception 'ITEM_INEXISTENTE'; end if;
  return public.flama_plan_get(f);
end $$;

-- ---------- Stock ----------
create or replace function public.flama_stock_get() returns json
language sql security definer set search_path = flama as $$
  select json_build_object(
    'insumos', coalesce((
      select json_agg(json_build_object(
        'id', i.id, 'nombre', i.nombre, 'rubro', i.rubro, 'unidad', i.unidad, 'minimo', i.minimo, 'orden', i.orden,
        'ultimo_fecha', u.fecha, 'ultimo_cantidad', u.cantidad) order by i.orden)
      from flama.insumos i
      left join lateral (select fecha, cantidad from flama.conteos c where c.insumo_id = i.id order by fecha desc limit 1) u on true
      where i.activo), '[]'::json),
    'fechas', coalesce((select json_agg(f order by f desc) from (select distinct fecha f from flama.conteos order by f desc limit 8) x), '[]'::json)
  );
$$;

create or replace function public.flama_conteo_get(p_fecha date) returns json
language sql security definer set search_path = flama as $$
  select json_build_object('fecha', p_fecha, 'items', coalesce((
    select json_agg(json_build_object('insumo_id', insumo_id, 'cantidad', cantidad))
    from flama.conteos where fecha = p_fecha), '[]'::json));
$$;

create or replace function public.flama_conteo_guardar(p_fecha date, p_items json) returns json
language plpgsql security definer set search_path = flama as $$
declare it json;
begin
  for it in select * from json_array_elements(coalesce(p_items, '[]'::json)) loop
    if it->>'cantidad' is null or trim(it->>'cantidad') = '' then
      delete from flama.conteos where fecha = p_fecha and insumo_id = it->>'insumo_id';
    else
      insert into flama.conteos (fecha, insumo_id, cantidad) values (p_fecha, it->>'insumo_id', (it->>'cantidad')::numeric)
      on conflict (fecha, insumo_id) do update set cantidad = excluded.cantidad, actualizado = now();
    end if;
  end loop;
  return public.flama_stock_get();
end $$;

create or replace function public.flama_minimos_guardar(p_pin text, p_items json) returns json
language plpgsql security definer set search_path = flama as $$
declare it json;
begin
  if not flama.pin_ok(p_pin) then raise exception 'PIN_INCORRECTO'; end if;
  for it in select * from json_array_elements(coalesce(p_items, '[]'::json)) loop
    update flama.insumos set minimo = nullif(trim(coalesce(it->>'minimo', '')), '')::numeric where id = it->>'insumo_id';
  end loop;
  return public.flama_stock_get();
end $$;

-- Permisos: solo las funciones públicas flama_* son accesibles desde la web.
revoke all on function flama.pin_ok(text) from public, anon, authenticated;
grant execute on function
  public.flama_pin_estado(), public.flama_pin_set(text, text),
  public.flama_plan_get(date), public.flama_plan_guardar(text, date, text, json), public.flama_item_marcar(bigint, boolean),
  public.flama_stock_get(), public.flama_conteo_get(date), public.flama_conteo_guardar(date, json), public.flama_minimos_guardar(text, json)
to anon, authenticated;

-- Semilla de insumos (de FLAMA_control_stock.xlsx, hoja Stock). Sin mínimos ni conteos.
-- Las cuatro elaboraciones propias usan el mismo id que en recetas.json.
insert into flama.insumos (id, nombre, rubro, unidad, orden) values
  ('ojo-de-bife-angus', 'Ojo de bife angus', 'Carnes', 'kg', 10),
  ('tapa-de-bife-angus-alto-marmoleo', 'Tapa de bife angus alto marmoleo', 'Carnes', 'kg', 20),
  ('cheddar-barra', 'Cheddar barra', 'Queso / Fiambres', 'barra de 192 fetas', 30),
  ('panceta-sugardale-feteada', 'Panceta Sugardale feteada', 'Queso / Fiambres', 'caja 7 kg', 40),
  ('panceta-premium-el-araucano', 'Panceta premium (El Araucano)', 'Queso / Fiambres', 'kg', 50),
  ('parmesano', 'Parmesano', 'Queso / Fiambres', 'kg', 60),
  ('pan-flama-hobs', 'Pan Flama Hobs', 'Panadería', 'unidad', 70),
  ('papas-mccain-crispers', 'Papas McCain Crispers', 'Congelados', 'bolsa 2,5 kg', 80),
  ('lechuga-repollada', 'Lechuga repollada', 'Verdulería', 'kg', 90),
  ('tomate-redondo', 'Tomate redondo', 'Verdulería', 'kg', 100),
  ('cebolla', 'Cebolla', 'Verdulería', 'kg', 110),
  ('cebolla-morada', 'Cebolla morada', 'Verdulería', 'kg', 120),
  ('ajo', 'Ajo', 'Verdulería', 'cabeza', 130),
  ('limon', 'Limón', 'Verdulería', 'kg', 140),
  ('emmys-infusion', 'Emmy''s Infusion', 'Elaboración propia', 'kg', 150),
  ('lactonesa-trufada', 'Lactonesa trufada', 'Elaboración propia', 'kg', 160),
  ('salsa-original', 'Salsa Original', 'Elaboración propia', 'kg', 170),
  ('bacon-jam', 'Bacon jam', 'Elaboración propia', 'g', 180),
  ('mayonesa-heinz', 'Mayonesa Heinz', 'Aderezos', 'pouch 2,9 kg', 190),
  ('ketchup-heinz', 'Kétchup Heinz', 'Aderezos', 'pouch 2,9 kg', 200),
  ('mostaza-flama', 'Mostaza Flama', 'Aderezos', 'unidad', 210),
  ('relish-de-pepino-heinz', 'Relish de pepino Heinz', 'Aderezos', 'PET 375 ml', 220),
  ('salsa-chipotle-herdez', 'Salsa chipotle Herdez', 'Aderezos', 'frasco 240 g', 230),
  ('aceite-de-girasol-comun', 'Aceite de girasol común', 'Almacén', 'bidón 5 lt', 240),
  ('aceite-alto-oleico-el-principito', 'Aceite alto oleico El Principito', 'Almacén', 'bidón 17,5 kg', 250),
  ('leche-entera-larga-vida', 'Leche entera larga vida', 'Almacén', 'unidad 1 lt', 260),
  ('manteca', 'Manteca', 'Almacén', 'pilón 5 kg', 270),
  ('azucar', 'Azúcar', 'Almacén', 'kg', 280),
  ('sal-fina', 'Sal fina', 'Almacén', 'kg', 290),
  ('vinagre-de-alcohol', 'Vinagre de alcohol', 'Almacén', 'bidón 5 lts', 300),
  ('vinagre-de-manzana', 'Vinagre de manzana', 'Almacén', 'botella 1 lt', 310),
  ('salsa-de-soja', 'Salsa de soja', 'Almacén', 'unidad', 320),
  ('togarashi', 'Togarashi', 'Almacén', 'g', 330),
  ('sesamo-negro', 'Sésamo negro', 'Almacén', 'g', 340),
  ('pimienta-negra-en-grano', 'Pimienta negra en grano', 'Almacén', 'g', 350),
  ('pimenton-dulce', 'Pimentón dulce', 'Almacén', 'g', 360),
  ('cafe-tostado-molido', 'Café tostado molido', 'Almacén', 'g', 370),
  ('aceite-de-trufa-la-molisana', 'Aceite de trufa La Molisana', 'Almacén', 'botella 100 ml', 380),
  ('trufa-fresca', 'Trufa fresca', 'Almacén', 'g', 390),
  ('papel-higienico', 'Papel higiénico', 'Descartables', 'unidad', 400),
  ('toalla-de-mano', 'Toalla de mano', 'Descartables', 'caja', 410),
  ('cofia', 'Cofia', 'Descartables', 'paquete 100 u', 420),
  ('guante-nitrilo-m', 'Guante nitrilo M', 'Descartables', 'caja', 430),
  ('guantes-nitrilo-l', 'Guantes nitrilo L', 'Descartables', 'unidad', 440),
  ('bobina-de-papel', 'Bobina de papel', 'Descartables', 'unidad', 450),
  ('folex-25x35', 'Folex 25x35', 'Descartables', 'kg', 460),
  ('papel-film-rollo-1000-mts', 'Papel film rollo 1000 mts', 'Descartables', 'unidad', 470),
  ('papel-aluminio', 'Papel aluminio', 'Descartables', 'kg', 480),
  ('rotulo-de-balanza', 'Rótulo de balanza', 'Descartables', 'unidad', 490),
  ('rollo-comandera', 'Rollo comandera', 'Descartables', 'unidad', 500),
  ('rollo-posnet', 'Rollo posnet', 'Descartables', 'unidad', 510),
  ('servilletas-flama', 'Servilletas Flama', 'Descartables', 'caja', 520),
  ('parafinado-flama', 'Parafinado Flama', 'Packaging', 'kg', 530),
  ('detergente-dea', 'Detergente DEA', 'Limpieza', 'bidón 4 lts', 540),
  ('antigrasa-ic-115', 'Antigrasa IC-115', 'Limpieza', 'unidad', 550),
  ('perinol-grasas-carbonizadas', 'Perinol grasas carbonizadas', 'Limpieza', 'unidad', 560),
  ('ml-100', 'ML 100', 'Limpieza', 'unidad', 570),
  ('lavandina', 'Lavandina', 'Limpieza', 'unidad', 580),
  ('alcohol', 'Alcohol', 'Limpieza', 'litro', 590),
  ('jabon-liquido', 'Jabón líquido', 'Limpieza', 'bidón 5 lts', 600),
  ('perfumina', 'Perfumina', 'Limpieza', 'bidón 5 lts', 610),
  ('limpiavidrios-250-ml', 'Limpiavidrios 250 ml', 'Limpieza', 'unidad', 620),
  ('bolsa-de-residuo-120x90', 'Bolsa de residuo 120x90', 'Limpieza', 'unidad', 630),
  ('bolsa-de-residuo-60x90', 'Bolsa de residuo 60x90', 'Limpieza', 'unidad', 640),
  ('escobillon', 'Escobillón', 'Limpieza', 'unidad', 650),
  ('cabo-de-aluminio', 'Cabo de aluminio', 'Limpieza', 'unidad', 660),
  ('palita-de-basura', 'Palita de basura', 'Limpieza', 'unidad', 670),
  ('secador-de-piso', 'Secador de piso', 'Limpieza', 'unidad', 680),
  ('trapo-de-piso', 'Trapo de piso', 'Limpieza', 'unidad', 690),
  ('rejilla', 'Rejilla', 'Limpieza', 'unidad', 700),
  ('pano-de-cocina', 'Paño de cocina', 'Limpieza', 'unidad', 710),
  ('esponja-de-fibra-verde', 'Esponja de fibra verde', 'Limpieza', 'unidad', 720),
  ('esponja-esponjosa', 'Esponja esponjosa', 'Limpieza', 'unidad', 730),
  ('fibra-extra-fuerte-con-agarradera', 'Fibra extra fuerte con agarradera', 'Limpieza', 'unidad', 740),
  ('balde-para-limpieza', 'Balde para limpieza', 'Limpieza', 'unidad', 750),
  ('pulverizador', 'Pulverizador', 'Limpieza', 'unidad', 760)
on conflict (id) do nothing;
