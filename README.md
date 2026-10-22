# FLAMA · Cocina

Web interna para consultar recetas, escalar producciones, cargar la producción del día y llevar el stock. HTML, CSS y JavaScript vanilla. Sin frameworks ni build.

Publicada en https://berton33.github.io/flama-cocina/

## Archivos

- `recetas.json` — única fuente de datos de recetas.
- `consumos.json` — datos para calcular consumo y pedidos desde las ventas (no es receta: contenidos de unidades de compra, correspondencias y calendario de pedidos). Gramajes, nombres, procedimientos y notas viven acá. Para cambiar un gramaje se edita este archivo y nada más.
- `index.html`, `styles.css`, `app.js` — la web. No contienen datos de recetas.
- `config.js` — URL y clave pública (anon) del proyecto Supabase. La clave es pública por diseño; la protección está en la base.
- `api.js` — llamadas a las funciones `flama_*` de Supabase. No se lee ni escribe ninguna tabla en forma directa.
- `supabase/flama.sql` — esquema `flama`, funciones y semilla de insumos. Ya está aplicado al proyecto; queda versionado como referencia.

## Pantallas

- **Producción del día**: vista de cocina. Muestra lo que hay que producir hoy con un casillero grande por ítem y la nota del día. Lo que se tilda queda guardado y se ve desde cualquier dispositivo. Se refresca sola cada 20 segundos.
- **Cargar producción** (con PIN): fecha, qué producciones van y cuánto, nota del día.
- **Productos**, **Producción** (recetas con escalador) y **Notas**: leen `recetas.json`.
- **Pedidos**: a partir de los reportes diarios del sistema (que sube salón) y las recetas: **Pedido sugerido** por insumo en unidades de compra para el próximo pedido (lunes o viernes), con consumo esperado por día de semana, margen de seguridad y descuento del último conteo; **Producción** con el consumo esperado de cada salsa; **Ventas** por producto y por día. Los contenidos por unidad de compra, las correspondencias componente → insumo, el margen y el calendario de pedidos están en `consumos.json`.
- **Stock**: conteo por insumo en la unidad indicada (lunes y viernes), guardado por fecha. **Pedido sugerido**: lo que está por debajo del mínimo según el último conteo. **Mínimos** (con PIN).

## PIN de carga

La primera vez que se entra a Cargar producción o a Mínimos, la web pide definir el PIN. Se guarda hasheado en la base y se verifica en cada guardado. Cocina no lo necesita: tildar y contar no piden PIN. Se cambia desde el enlace "Cambiar PIN" en la pantalla de carga.

## Base de datos

Proyecto Supabase "Marvel Compartido", esquema `flama` (no expuesto por la API). Tablas: `planes`, `plan_items`, `insumos`, `conteos`, `config`. La web solo llama a las funciones `public.flama_*`, que corren con permisos propios y validan el PIN donde corresponde.

## Levantarla en local

El navegador bloquea la lectura de `recetas.json` si la página se abre con doble clic. Hay que servir la carpeta por HTTP:

```bash
python -m http.server 8123
```

Después abrir http://localhost:8123. Para verla en el celular en la misma red Wi-Fi, usar la IP de la PC en lugar de `localhost`.

## Publicar cambios

Commit en `main` y `git push`. GitHub Pages redespliega solo en un minuto.

## Escalado

En cada producción se ingresa la cantidad total a producir, en la unidad definida por `batch.unidad_escalado` del JSON (kg para las salsas de 1 kg, g para el bacon jam). Los ingredientes y el rendimiento se recalculan proporcionalmente y se muestran redondeados a 1 decimal. Tiempos y temperaturas del procedimiento no escalan. Las sub-preparaciones mantienen sus cantidades base y muestran cuántas tandas hay que preparar.
