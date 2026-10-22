/* FLAMA · Cocina
 * Recetas: toda la información (nombres, gramajes, procedimientos, notas) viene de recetas.json.
 * Producción del día y stock: datos en Supabase, a través de api.js.
 * Este archivo solo sabe leer esas estructuras y mostrarlas.
 */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const topbarSub = document.getElementById('topbar-sub');
  const API = window.FLAMA_API;
  let DATA = null;
  let CONS = null; // consumos.json: contenidos de insumos y correspondencias para calcular consumo
  let pollTimer = null;

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Redondeo a 1 decimal, formato es-AR (coma decimal).
  const fmt = (n) => {
    const r = Math.round(Number(n) * 10) / 10;
    return r.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  };
  const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };

  const byId = (list, id) => list.find((x) => x.id === id);

  const hoyISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const fechaLarga = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  };
  const fechaCorta = (iso) => {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
  };
  const hora = (ts) => ts ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';

  // Un componente/ingrediente tiene unidad (g/ml) o unidad_pieza (feta, gotas, unidad).
  function qtyHtml(c, factor) {
    if (c.unidad_pieza) return `${fmt(c.cantidad)}<span class="u"> ${esc(c.unidad_pieza)}</span>`;
    const q = factor == null ? c.cantidad : c.cantidad * factor;
    return `${fmt(q)}<span class="u"> ${esc(c.unidad)}</span>`;
  }

  const errorMsg = (e) => e && e.code === 'PIN_INCORRECTO' ? 'PIN incorrecto.'
    : e && e.code === 'PIN_INVALIDO' ? 'El PIN tiene que tener entre 4 y 32 caracteres.'
    : `No se pudo conectar con la base (${esc(e && e.message)}).`;

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  // ---------- rutas ----------
  function parseHash() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [section, id] = h.split('/');
    return { section: section || '', id: id || null };
  }

  function route() {
    if (!DATA) return;
    stopPolling();
    const { section, id } = parseHash();
    window.scrollTo(0, 0);
    switch (section) {
      case '':
        topbarSub.textContent = 'Cocina';
        return renderInicio();
      case 'productos':
        topbarSub.textContent = 'Productos';
        return id ? renderProducto(id) : renderProductos();
      case 'produccion':
        topbarSub.textContent = 'Producción';
        return id ? renderProduccion(id) : renderProducciones();
      case 'notas':
        topbarSub.textContent = 'Notas';
        return renderNotas();
      case 'dia':
        topbarSub.textContent = 'Producción del día';
        return id === 'cargar' ? renderDiaCargar() : renderDia();
      case 'pedidos':
        topbarSub.textContent = 'Pedidos';
        return renderPedidos(id || 'pedido');
      case 'stock':
        topbarSub.textContent = 'Stock';
        return id === 'pedido' ? renderPedido() : id === 'minimos' ? renderMinimos() : id === 'ver' ? renderVerStock() : renderStock();
      default:
        location.hash = '#/';
    }
  }

  // ---------- 1. inicio ----------
  function renderInicio() {
    app.innerHTML = `<div class="home">
      <a href="#/dia">Producción del día</a>
      <a href="#/productos">Productos</a>
      <a href="#/produccion">Producción</a>
      <a href="#/stock">Stock</a>
      <a href="#/pedidos">Pedidos</a>
      <a href="#/notas">Notas</a>
    </div>`;
  }

  // ---------- 2. productos ----------
  function renderProductos() {
    const cats = DATA.categorias || {};
    const tipos = Object.keys(cats);
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Productos</h1>`;
    const tile = (p) => `
      <a class="tile" href="#/productos/${esc(p.id)}">
        <div><div class="tile-title">${esc(p.nombre)}</div>
        <div class="sub">${p.componentes.length} componentes</div></div>
        <span class="chev">›</span>
      </a>`;
    for (const tipo of tipos) {
      const items = DATA.productos.filter((p) => p.tipo === tipo);
      if (!items.length) continue;
      html += `<h2>${esc(cats[tipo].titulo || tipo)}</h2><div class="list">${items.map(tile).join('')}</div>`;
    }
    const otros = DATA.productos.filter((p) => !tipos.includes(p.tipo));
    if (otros.length) html += `<h2>Otros</h2><div class="list">${otros.map(tile).join('')}</div>`;
    app.innerHTML = html;
  }

  function renderProducto(id) {
    const p = byId(DATA.productos, id);
    if (!p) return notFound('Producto');
    const cat = (DATA.categorias || {})[p.tipo] || {};

    let html = `<a class="back" href="#/productos">‹ Productos</a>`;
    html += `<h1>${esc(p.nombre)}</h1>`;

    if (p.resumen) {
      html += `<div class="card"><div class="meta">` + Object.entries(p.resumen).map(([k, v]) =>
        `<div><span class="k">${esc(k)}</span><span class="v">${fmt(v.cantidad)} ${esc(v.unidad)}</span></div>`).join('') + `</div></div>`;
    }
    if (cat.intro) html += `<p class="lede">${esc(cat.intro)}</p>`;

    html += `<h2>Armado · de la base a la tapa</h2><div class="card"><table><tbody>` +
      p.componentes.map((c) => {
        const name = c.produccion_id
          ? `<a class="link" href="#/produccion/${esc(c.produccion_id)}">${esc(c.componente)}</a>`
          : esc(c.componente);
        return `<tr><td class="n">${esc(c.orden)}</td><td>${name}</td><td class="q">${qtyHtml(c)}</td></tr>`;
      }).join('') + `</tbody></table></div>`;

    if (p.armado) html += `<div class="note"><span class="k">Armado</span>${esc(p.armado)}</div>`;
    if (p.emplatado) html += `<div class="note"><span class="k">Emplatado</span>${esc(p.emplatado)}</div>`;

    if (cat.fritura) {
      const f = cat.fritura;
      html += `<h2>Fritura</h2><div class="card"><div class="meta">
        <div><span class="k">Temperatura</span><span class="v">${fmt(f.temperatura.valor)} ${esc(f.temperatura.unidad)}</span></div>
        <div><span class="k">Tiempo</span><span class="v">${fmt(f.tiempo.min)} a ${fmt(f.tiempo.max)} ${esc(f.tiempo.unidad)}</span></div>
        <div><span class="k">Etapas</span><span class="v">${esc(f.etapas)}</span></div>
        <div><span class="k">Desde</span><span class="v">${esc(f.desde)}</span></div>
      </div></div>`;
    }
    app.innerHTML = html;
  }

  // ---------- 3. producción (recetas de salsas) ----------
  function renderProducciones() {
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Producción</h1><div class="list">` +
      DATA.producciones.map((p) => `
        <a class="tile" href="#/produccion/${esc(p.id)}">
          <div><div class="tile-title">${esc(p.nombre)}</div>
          <div class="sub">Batch ${esc(p.batch.texto)} · ${fmt(p.rendimiento.cantidad)} ${esc(p.rendimiento.unidad)} · ${esc(p.vida_util.texto)}</div></div>
          <span class="chev">›</span>
        </a>`).join('') + `</div>`;
  }

  function renderProduccion(id) {
    const p = byId(DATA.producciones, id);
    if (!p) return notFound('Producción');
    const b = p.batch;
    const unidadIngreso = b.unidad_escalado || b.unidad;
    const baseIngreso = unidadIngreso === 'kg' ? b.cantidad / 1000 : b.cantidad;

    const notas = (p.notas && p.notas.items) || [];
    const avisos = notas.filter((n) => typeof n === 'object' && n.advertencia_escalado);
    const notasResto = notas.filter((n) => !(typeof n === 'object' && n.advertencia_escalado));

    let html = `<a class="back" href="#/produccion">‹ Producción</a>`;
    html += `<h1>${esc(p.nombre)}</h1>`;
    if (p.descripcion) html += `<p class="lede">${esc(p.descripcion)}</p>`;

    html += `<div class="card"><div class="meta">
      <div><span class="k">Batch base</span><span class="v">${esc(b.texto)}</span></div>
      <div><span class="k">Rinde</span><span class="v">${fmt(p.rendimiento.cantidad)} ${esc(p.rendimiento.unidad)}</span></div>
      <div><span class="k">Vida útil</span><span class="v">${esc(p.vida_util.texto)}</span></div>
      <div><span class="k">Conservación</span><span class="v">${esc(p.conservacion)}</span></div>
    </div></div>`;

    html += `<div class="card scaler">
      <label for="qty">Quiero producir</label>
      <div class="row">
        <input id="qty" type="text" inputmode="decimal" autocomplete="off" value="${baseIngreso}">
        <span class="unit">${esc(unidadIngreso)}</span>
      </div>
      <div class="result" id="scale-result"></div>
    </div>`;

    for (const a of avisos) html += `<div class="warn"><span class="k">Atención al escalar</span>${esc(a.texto)}</div>`;

    html += `<h2>Ingredientes</h2><div class="card"><table id="ing"><tbody>` +
      p.ingredientes.map((i, idx) => {
        const name = i.subpreparacion_id
          ? `<a class="link" href="#sub-${esc(i.subpreparacion_id)}" data-anchor>${esc(i.ingrediente)}</a>`
          : esc(i.ingrediente);
        return `<tr data-idx="${idx}"><td>${name}</td><td class="q">${qtyHtml(i, 1)}</td></tr>`;
      }).join('') + `</tbody></table></div>`;

    if (p.subpreparaciones && p.subpreparaciones.length) {
      html += `<h2>Sub-preparaciones</h2>`;
      for (const s of p.subpreparaciones) {
        html += `<div class="card" id="sub-${esc(s.id)}"><strong>${esc(s.nombre)}</strong>
          <p class="lede" style="margin:4px 0 8px">Cantidades base por tanda · no escalan</p>
          <div class="tandas" id="tandas-${esc(s.id)}"></div>
          <table><tbody>` + s.ingredientes.map((i) => {
            const extra = i.temperatura ? ` <span class="u">a ${fmt(i.temperatura.min)} a ${fmt(i.temperatura.max)} ${esc(i.temperatura.unidad)}</span>` : '';
            return `<tr><td>${esc(i.ingrediente)}${extra}</td><td class="q">${qtyHtml(i)}</td></tr>`;
          }).join('') + `</tbody></table>`;
        if (s.rendimiento) html += `<p style="margin:10px 0 0"><b>Rinde</b> ${s.rendimiento.aproximado ? '~' : ''}${fmt(s.rendimiento.cantidad)} ${esc(s.rendimiento.unidad)}${s.nota ? ` · ${esc(s.nota)}` : ''}</p>`;
        html += `</div>`;
      }
    }

    html += `<h2>Procedimiento · tiempos y temperaturas no escalan</h2><div class="card"><ol class="steps">` +
      p.procedimiento.map((s) => {
        const link = s.subpreparacion_id ? ` <a class="link" href="#sub-${esc(s.subpreparacion_id)}" data-anchor>Ver sub-preparación</a>` : '';
        return `<li><span class="num">${esc(s.paso)}</span><div><div class="t">${esc(s.titulo)}</div><div class="x">${esc(s.texto)}${link}</div></div></li>`;
      }).join('') + `</ol></div>`;

    if (notasResto.length) {
      html += `<h2>${esc((p.notas && p.notas.titulo) || 'Notas')}</h2><div class="card"><ul class="plain">` +
        notasResto.map((n) => `<li>${esc(typeof n === 'string' ? n : n.texto)}</li>`).join('') + `</ul></div>`;
    }

    app.innerHTML = html;
    wireScaler(p, unidadIngreso);
    wireAnchors();
  }

  // Escalado: factor = cantidad pedida / batch base. Ingredientes y rendimiento se
  // multiplican por el factor; el procedimiento no se toca.
  function wireScaler(p, unidadIngreso) {
    const input = document.getElementById('qty');
    const result = document.getElementById('scale-result');
    const rows = Array.from(document.querySelectorAll('#ing tbody tr'));
    const b = p.batch;
    const baseIngreso = unidadIngreso === 'kg' ? b.cantidad / 1000 : b.cantidad;

    function apply() {
      const val = num(input.value);
      const total = val != null && val > 0 ? val : baseIngreso;
      const totalBase = unidadIngreso === 'kg' ? total * 1000 : total;
      const factor = totalBase / b.cantidad;
      rows.forEach((tr) => {
        const ing = p.ingredientes[Number(tr.dataset.idx)];
        tr.querySelector('td.q').innerHTML = qtyHtml(ing, factor);
        tr.classList.toggle('scaled', Math.abs(factor - 1) > 1e-9);
      });
      const rinde = p.rendimiento.cantidad * factor;
      result.innerHTML = `Factor <b>×${fmt(factor)}</b> · Rinde <b>${fmt(rinde)} ${esc(p.rendimiento.unidad)}</b>` +
        (b.estimado ? ` · batch base estimado` : '');
      updateTandas(p, factor);
    }

    input.addEventListener('input', apply);
    apply();
  }

  // Sub-preparaciones: las cantidades base no cambian; lo que cambia es cuántas
  // tandas hay que preparar. Batches por tanda = rendimiento de la sub-preparación
  // dividido por lo que usa un batch base. Tandas = techo(batches solicitados / batches por tanda).
  function updateTandas(p, factor) {
    for (const s of p.subpreparaciones || []) {
      const el = document.getElementById(`tandas-${s.id}`);
      if (!el) continue;
      const ing = p.ingredientes.find((i) => i.subpreparacion_id === s.id);
      const r = s.rendimiento;
      if (!ing || !r || !ing.cantidad || ing.unidad !== r.unidad) { el.innerHTML = ''; continue; }
      const batchesPorTanda = r.cantidad / ing.cantidad;
      const tandas = Math.max(1, Math.ceil(factor / batchesPorTanda - 1e-9));
      el.innerHTML = `<span class="k">Preparar</span><b>${tandas} ${tandas === 1 ? 'tanda' : 'tandas'}</b>` +
        `<span class="d">Cada tanda rinde ${r.aproximado ? '~' : ''}${fmt(r.cantidad)} ${esc(r.unidad)} y alcanza para ${fmt(batchesPorTanda)} batches · pedido: ×${fmt(factor)}</span>`;
    }
  }

  // Anclas internas (#sub-...) sin disparar el router.
  function wireAnchors() {
    document.querySelectorAll('a[data-anchor]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const el = document.querySelector(a.getAttribute('href'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ---------- 4. notas generales de cocina ----------
  function renderNotas() {
    const n = DATA.notas || {};
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Notas de cocina</h1>`;
    if (n.intro) html += `<p class="lede">${esc(n.intro)}</p>`;
    for (const s of n.secciones || []) {
      html += `<h2>${esc(s.titulo)}</h2><div class="card"><ol class="steps">` +
        s.items.map((it, i) => {
          const val = it.valor != null ? `: <b>${fmt(it.valor)} ${esc(it.unidad || '')}</b>` : '';
          return `<li><span class="num">${i + 1}</span><div class="x">${esc(it.texto)}${val}</div></li>`;
        }).join('') + `</ol></div>`;
    }
    app.innerHTML = html;
  }

  // ---------- 5. producción del día · vista cocina ----------
  function nombreProduccion(id) { const p = byId(DATA.producciones, id); return p ? p.nombre : id; }

  async function renderDia() {
    const fecha = hoyISO();
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Producción del día</h1>
      <p class="fecha-label">${esc(fechaLarga(fecha))}</p><p class="msg">Cargando…</p>`;

    const paint = (plan) => {
      const items = plan.items || [];
      const hechos = items.filter((i) => i.hecho).length;
      let html = `<a class="back" href="#/">‹ Inicio</a><h1>Producción del día</h1>
        <p class="fecha-label">${esc(fechaLarga(fecha))}</p>`;
      if (!items.length && !plan.nota) {
        html += `<div class="card"><p class="msg" style="padding:12px 0">No hay producción cargada para hoy.</p></div>`;
      } else {
        if (items.length) html += `<p class="progress"><b>${hechos}</b> de <b>${items.length}</b> listas</p>`;
        html += items.map((i) => `
          <div class="check ${i.hecho ? 'done' : ''}" data-id="${esc(i.id)}" data-hecho="${i.hecho ? 1 : 0}" role="button" tabindex="0">
            <div class="box">${i.hecho ? '✓' : ''}</div>
            <div><div class="name">${esc(nombreProduccion(i.produccion_id))}</div>
              <div class="sub">${i.hecho ? `Listo ${esc(hora(i.hecho_at))}` : 'Tocar cuando esté hecho'}</div></div>
            <div class="qty">${fmt(i.cantidad)}<span class="u"> ${esc(i.unidad)}</span></div>
          </div>`).join('');
        if (plan.nota) html += `<div class="note"><span class="k">Nota del día</span>${esc(plan.nota)}</div>`;
      }
      html += `<div id="dia-status"></div>
        <a class="btn secondary small" href="#/dia/cargar">Cargar o editar producción</a>`;
      app.innerHTML = html;

      app.querySelectorAll('.check').forEach((el) => {
        const toggle = async () => {
          if (el.classList.contains('busy')) return;
          el.classList.add('busy');
          try {
            const nuevo = await API.itemMarcar(Number(el.dataset.id), el.dataset.hecho !== '1');
            paint(nuevo);
          } catch (e) {
            el.classList.remove('busy');
            document.getElementById('dia-status').innerHTML = `<div class="status err">${errorMsg(e)}</div>`;
          }
        };
        el.addEventListener('click', toggle);
        el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
      });
    };

    const load = async () => {
      try { paint(await API.planGet(fecha)); }
      catch (e) { app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Producción del día</h1><div class="status err">${errorMsg(e)}</div>`; }
    };
    await load();
    // Se refresca sola cada 20 s mientras la pantalla esté visible, y al volver a la pestaña.
    pollTimer = setInterval(() => { if (!document.hidden && parseHash().section === 'dia' && !parseHash().id) load(); }, 20000);
  }

  // ---------- 6. producción del día · vista de carga (PIN) ----------
  async function renderDiaCargar() {
    app.innerHTML = `<a class="back" href="#/dia">‹ Producción del día</a><h1>Cargar producción</h1><p class="msg">Cargando…</p>`;
    let estado;
    try { estado = await API.pinEstado(); }
    catch (e) { app.innerHTML = `<a class="back" href="#/dia">‹ Producción del día</a><h1>Cargar producción</h1><div class="status err">${errorMsg(e)}</div>`; return; }
    if (!estado.definido) return renderDefinirPin(() => renderDiaCargar());

    const fecha0 = hoyISO();
    let html = `<a class="back" href="#/dia">‹ Producción del día</a><h1>Cargar producción</h1>
      <div class="card">
        <label class="field"><span>Fecha</span><input id="fecha" type="date" value="${fecha0}"></label>
        <div id="plan-info" class="lede"></div>
      </div>
      <h2>Qué se produce</h2><div class="card">` +
      DATA.producciones.map((p, idx) => {
        const u = p.batch.unidad_escalado || p.batch.unidad;
        return `<div class="pick" data-id="${esc(p.id)}" data-orden="${idx + 1}" data-unidad="${esc(u)}">
          <div class="box" role="button" tabindex="0"></div>
          <div><div class="name">${esc(p.nombre)}</div><div class="sub">Batch base ${esc(p.batch.texto)}</div></div>
          <div><input type="text" inputmode="decimal" autocomplete="off" placeholder="0" disabled><div class="unit">${esc(u)}</div></div>
        </div>`;
      }).join('') +
      `</div>
      <div class="card">
        <label class="field"><span>Nota del día</span><textarea id="nota" placeholder="Opcional"></textarea></label>
        <label class="field"><span>PIN</span><input id="pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label>
        <div id="cargar-status"></div>
        <button class="btn" id="guardar">Guardar</button>
      </div>
      <p class="lede" style="text-align:center"><a class="link" href="#" id="cambiar-pin">Cambiar PIN</a></p>`;
    app.innerHTML = html;

    const fechaEl = document.getElementById('fecha');
    const status = document.getElementById('cargar-status');
    const picks = Array.from(app.querySelectorAll('.pick'));

    const setPick = (el, on, cantidad) => {
      el.classList.toggle('on', on);
      el.querySelector('.box').textContent = on ? '✓' : '';
      const inp = el.querySelector('input');
      inp.disabled = !on;
      if (cantidad != null) inp.value = String(cantidad).replace('.', ',');
      if (!on) inp.value = '';
    };
    picks.forEach((el) => {
      const box = el.querySelector('.box');
      const toggle = () => { const on = !el.classList.contains('on'); setPick(el, on); if (on) el.querySelector('input').focus(); };
      box.addEventListener('click', toggle);
      box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    });

    // Al cambiar la fecha se trae lo ya cargado para ese día, para editarlo.
    async function cargarFecha() {
      const f = fechaEl.value;
      if (!f) return;
      status.innerHTML = '';
      try {
        const plan = await API.planGet(f);
        picks.forEach((el) => {
          const it = (plan.items || []).find((i) => i.produccion_id === el.dataset.id);
          setPick(el, !!it, it ? it.cantidad : null);
        });
        document.getElementById('nota').value = plan.nota || '';
        document.getElementById('plan-info').textContent = (plan.items || []).length
          ? `Ya hay ${plan.items.length} producciones cargadas para ${fechaLarga(f)}. Guardar reemplaza la lista; las tildes de cocina se conservan.`
          : `Sin producción cargada para ${fechaLarga(f)}.`;
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    }
    fechaEl.addEventListener('change', cargarFecha);
    await cargarFecha();

    document.getElementById('guardar').addEventListener('click', async () => {
      const f = fechaEl.value;
      const p = document.getElementById('pin').value.trim();
      const items = [];
      for (const el of picks) {
        if (!el.classList.contains('on')) continue;
        const c = num(el.querySelector('input').value);
        if (c == null || c <= 0) { status.innerHTML = `<div class="status err">Falta la cantidad de ${esc(nombreProduccion(el.dataset.id))}.</div>`; return; }
        items.push({ produccion_id: el.dataset.id, cantidad: c, unidad: el.dataset.unidad, orden: Number(el.dataset.orden) });
      }
      if (!f) { status.innerHTML = `<div class="status err">Elegí la fecha.</div>`; return; }
      if (!p) { status.innerHTML = `<div class="status err">Ingresá el PIN.</div>`; return; }
      const btn = document.getElementById('guardar');
      btn.disabled = true; status.innerHTML = '';
      try {
        await API.planGuardar(p, f, document.getElementById('nota').value, items);
        API.pin.set(p);
        status.innerHTML = `<div class="status ok">Guardado: ${items.length} producciones para ${esc(fechaLarga(f))}.</div>`;
        if (f === hoyISO()) setTimeout(() => { location.hash = '#/dia'; }, 900);
      } catch (e) {
        if (e.code === 'PIN_INCORRECTO') API.pin.clear();
        status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`;
      } finally { btn.disabled = false; }
    });

    document.getElementById('cambiar-pin').addEventListener('click', (ev) => { ev.preventDefault(); renderDefinirPin(() => renderDiaCargar(), true); });
  }

  // Primera vez: no hay PIN en la base, se define acá. Después: cambio con el PIN actual.
  function renderDefinirPin(volver, cambio) {
    app.innerHTML = `<a class="back" href="#/dia">‹ Producción del día</a><h1>${cambio ? 'Cambiar PIN' : 'Definir PIN'}</h1>
      <p class="lede">${cambio ? 'Ingresá el PIN actual y el nuevo.' : 'Todavía no hay PIN de carga. Definilo ahora: protege la carga de producción y los mínimos de stock. Cocina no lo necesita.'}</p>
      <div class="card">
        ${cambio ? `<label class="field"><span>PIN actual</span><input id="pin-actual" type="password" inputmode="numeric" autocomplete="off"></label>` : ''}
        <label class="field"><span>PIN nuevo</span><input id="pin-nuevo" type="password" inputmode="numeric" autocomplete="off"></label>
        <label class="field"><span>Repetir PIN nuevo</span><input id="pin-rep" type="password" inputmode="numeric" autocomplete="off"></label>
        <div id="pin-status"></div>
        <button class="btn" id="pin-ok">Guardar PIN</button>
        ${cambio ? `<button class="btn secondary small" id="pin-cancel">Cancelar</button>` : ''}
      </div>`;
    const status = document.getElementById('pin-status');
    document.getElementById('pin-ok').addEventListener('click', async () => {
      const nuevo = document.getElementById('pin-nuevo').value;
      const rep = document.getElementById('pin-rep').value;
      const actual = cambio ? document.getElementById('pin-actual').value : null;
      if (nuevo.length < 4) { status.innerHTML = `<div class="status err">El PIN tiene que tener al menos 4 caracteres.</div>`; return; }
      if (nuevo !== rep) { status.innerHTML = `<div class="status err">Los PIN no coinciden.</div>`; return; }
      try {
        await API.pinSet(actual, nuevo);
        API.pin.set(nuevo);
        volver();
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    });
    const cancel = document.getElementById('pin-cancel');
    if (cancel) cancel.addEventListener('click', volver);
  }


  // ---------- pedidos: consumo por ventas, pedido sugerido, producción sugerida, ventas ----------
  const DOW = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  const isoDow = (iso) => { const [y, m, d] = iso.split('-').map(Number); const w = new Date(y, m - 1, d).getDay(); return w === 0 ? 7 : w; };
  const addDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };

  function pedNav(sub) {
    return `<a class="back" href="#/">‹ Inicio</a><h1>Pedidos</h1>
      <div class="btnrow three"><a class="btn secondary small ${sub === 'pedido' ? 'on' : ''}" href="#/pedidos/pedido">Pedido sugerido</a><a class="btn secondary small ${sub === 'produccion' ? 'on' : ''}" href="#/pedidos/produccion">Producción</a><a class="btn secondary small ${sub === 'ventas' ? 'on' : ''}" href="#/pedidos/ventas">Ventas</a></div>`;
  }

  // Consumo de insumos por día a partir de las ventas (productos de cocina) y las recetas.
  // Devuelve { dias: [fecha…], insumos: {fecha: {insumo_id: base}}, salsas: {fecha: {produccion_id: g}}, productos: {fecha: {producto_id: cant}} }
  function calcularConsumo(ventas) {
    const comp = CONS.componentes || {}, alias = CONS.ingredientes_por_produccion || {};
    const out = { dias: [], insumos: {}, salsas: {}, productos: {} };
    const add = (obj, f, k, v) => { obj[f] = obj[f] || {}; obj[f][k] = (obj[f][k] || 0) + v; };
    const mapComp = (f, nombre, qty) => { for (const m of (comp[nombre] || [])) add(out.insumos, f, m.insumo_id, qty * m.base_por_unidad); };
    const diasSet = new Set((ventas.dias || []).map((d) => d.fecha));
    for (const it of (ventas.items || [])) {
      if (it.tipo !== 'cocina' || !it.destino_id) continue;
      const prod = byId(DATA.productos, it.destino_id); if (!prod) continue;
      const f = it.fecha, n = Number(it.cantidad); diasSet.add(f);
      add(out.productos, f, prod.id, n);
      for (const c of prod.componentes) {
        const q = n * Number(c.cantidad);
        if (c.produccion_id) add(out.salsas, f, c.produccion_id, q); else mapComp(f, c.componente, q);
      }
    }
    for (const f of Object.keys(out.salsas)) {
      for (const [pid, g] of Object.entries(out.salsas[f])) {
        const pr = byId(DATA.producciones, pid); if (!pr) continue;
        add(out.insumos, f, pid, g); // la salsa como insumo propio (stock de elaboración propia)
        for (const ing of pr.ingredientes) {
          const nombre = (alias[pid] || {})[ing.ingrediente] || ing.ingrediente;
          mapComp(f, nombre, g * Number(ing.cantidad) / Number(pr.batch.cantidad));
        }
      }
    }
    out.dias = [...diasSet].sort();
    for (const f of out.dias) for (const cf of (CONS.consumo_fijo_diario || [])) add(out.insumos, f, cf.insumo_id, cf.cantidad_base);
    return out;
  }

  // Promedio por día de semana (con los días que haya) y promedio general, por clave.
  function promedios(porDia, dias) {
    const porDow = {}, tot = {}; const nDow = {};
    for (const f of dias) { const w = isoDow(f); nDow[w] = (nDow[w] || 0) + 1; for (const [k, v] of Object.entries(porDia[f] || {})) { porDow[k] = porDow[k] || {}; porDow[k][w] = (porDow[k][w] || 0) + v; tot[k] = (tot[k] || 0) + v; } }
    const res = {};
    for (const k of Object.keys(tot)) {
      res[k] = { general: tot[k] / Math.max(1, dias.length), dow: {} };
      for (let w = 1; w <= 7; w++) res[k].dow[w] = nDow[w] ? (porDow[k][w] || 0) / nDow[w] : null;
    }
    return res;
  }
  const esperado = (pr, w) => (pr.dow[w] != null ? pr.dow[w] : pr.general);

  // Próximo pedido según consumos.json: qué día se pide, qué días cubre y qué días hay que aguantar con el stock actual.
  function proximoPedido(hoy) {
    const cerrados = new Set(CONS.dias_cerrados || []); const w0 = isoDow(hoy);
    let best = null;
    for (const e of CONS.entregas) { let d = (e.dia_pedido - w0 + 7) % 7; if (best == null || d < best.d) best = { d, e }; }
    const fechaPedido = addDias(hoy, best.d), entrega = addDias(fechaPedido, (best.e.dia_entrega - best.e.dia_pedido + 7) % 7);
    const puente = []; for (let f = hoy; f < entrega; f = addDias(f, 1)) if (!cerrados.has(isoDow(f))) puente.push(f);
    const cubre = []; let f = entrega; while (cubre.length < best.e.cubre.length) { if (best.e.cubre.includes(isoDow(f))) cubre.push(f); f = addDias(f, 1); if (cubre.length > 14) break; }
    return { fechaPedido, entrega, puente, cubre, hoyEsPedido: best.d === 0 };
  }

  async function cargarVentasYStock(diasAtras) {
    const hoy = hoyISO();
    const [v, s] = await Promise.all([API.ventasRango(addDias(hoy, -diasAtras), hoy), API.stockGet()]);
    return { v, s, hoy };
  }

  async function renderPedidos(sub) {
    if (!CONS) { app.innerHTML = pedNav(sub) + `<div class="status err">Falta consumos.json en el sitio.</div>`; return; }
    app.innerHTML = pedNav(sub) + `<p class="msg">Calculando…</p>`;
    let data;
    try { data = await cargarVentasYStock(28); } catch (e) { app.innerHTML = pedNav(sub) + `<div class="status err">${errorMsg(e)}</div>`; return; }
    if (!(data.v.dias || []).length) { app.innerHTML = pedNav(sub) + `<div class="card"><p class="msg" style="padding:12px 0">No hay reportes de ventas cargados en los últimos 28 días. Se suben desde la web de salón.</p></div>`; return; }
    if (sub === 'ventas') return renderVentas(data);
    if (sub === 'produccion') return renderProduccionSugerida(data);
    return renderPedidoSugerido(data);
  }

  function renderPedidoSugerido({ v, s, hoy }) {
    const cons = calcularConsumo(v), pr = promedios(cons.insumos, cons.dias), np = proximoPedido(hoy), margen = Number(CONS.margen_seguridad || 0);
    const stockPorId = {}; for (const i of s.insumos) stockPorId[i.id] = i;
    const filas = [];
    for (const [id, p] of Object.entries(pr)) {
      const info = CONS.insumos[id]; const ins = stockPorId[id]; if (!info || !ins) continue;
      if (DATA.producciones.some((pr) => pr.id === id)) continue; // las salsas propias se producen, no se piden: ver Producción
      const diario = p.general;
      const necesitaBase = (np.puente.reduce((a, f) => a + esperado(p, isoDow(f)), 0) + np.cubre.reduce((a, f) => a + esperado(p, isoDow(f)), 0)) * (1 + margen);
      const stockBase = ins.ultimo_cantidad != null ? Number(ins.ultimo_cantidad) * info.contenido : null;
      const cobertura = stockBase != null && diario > 0 ? stockBase / diario : null;
      const pedirBase = stockBase == null ? necesitaBase : Math.max(0, necesitaBase - stockBase);
      const pedir = Math.ceil(pedirBase / info.contenido - 1e-9);
      filas.push({ id, nombre: ins.nombre, rubro: ins.rubro, unidad: ins.unidad, base: info.base, diario, diarioCompra: diario / info.contenido, stock: ins.ultimo_cantidad, stockFecha: ins.ultimo_fecha, cobertura, necesita: necesitaBase / info.contenido, pedir, sinConteo: stockBase == null });
    }
    filas.sort((a, b) => (b.pedir - a.pedir) || a.nombre.localeCompare(b.nombre));
    const grupos = []; for (const f of filas) { let g = grupos.find((x) => x.rubro === f.rubro); if (!g) { g = { rubro: f.rubro, items: [] }; grupos.push(g); } g.items.push(f); }
    let html = pedNav('pedido') + `<p class="lede">Según las ventas de los últimos ${cons.dias.length} días con reporte y las recetas. ${np.hoyEsPedido ? `<b>Hoy es día de pedido.</b>` : `Próximo pedido: <b>${esc(DOW[isoDow(np.fechaPedido)])} ${esc(fechaCorta(np.fechaPedido))}</b>.`} Llega el ${esc(fechaCorta(np.entrega))} y cubre ${np.cubre.map((f) => esc(DOW[isoDow(f)])).join(', ')}. Hasta la entrega hay que aguantar ${np.puente.length} día${np.puente.length === 1 ? '' : 's'} con el stock actual. Margen de seguridad ${fmt(margen * 100)} %.</p>`;
    for (const g of grupos) {
      html += `<h2>${esc(g.rubro)}</h2><div class="card"><div class="scrollx"><table class="ctl"><thead><tr><th>Insumo</th><th class="q">Consumo/día</th><th class="q">Stock</th><th class="q">Cubre</th><th class="q">Necesita</th><th class="q">Pedir</th></tr></thead><tbody>` +
        g.items.map((f) => `<tr class="${f.pedir > 0 ? 'neg' : 'ok'}"><td><b>${esc(f.nombre)}</b><br><span class="sub">${esc(f.unidad)}${f.sinConteo ? ' · sin conteo' : ` · conteo ${esc(fechaCorta(f.stockFecha))}`}</span></td>
          <td class="q">${fmt(f.diarioCompra)}<br><span class="sub">${fmt(f.diario)} ${esc(f.base)}</span></td><td class="q">${f.stock != null ? fmt(f.stock) : '—'}</td><td class="q">${f.cobertura != null ? `${fmt(f.cobertura)} d` : '—'}</td><td class="q">${fmt(f.necesita)}</td><td class="q desc">${f.pedir > 0 ? fmt(f.pedir) : '0'}</td></tr>`).join('') + `</tbody></table></div></div>`;
    }
    html += `<p class="lede">Las salsas de elaboración propia no se piden: están en Producción. "Necesita" es el consumo esperado hasta que llegue el pedido siguiente, en unidades de compra, con el margen. "Pedir" descuenta el último conteo. Los insumos sin ventas asociadas (descartables, limpieza) siguen con el pedido por mínimos en Stock.</p>`;
    app.innerHTML = html;
  }

  function renderProduccionSugerida({ v, s, hoy }) {
    const cons = calcularConsumo(v), pr = promedios(cons.salsas, cons.dias); const cerrados = new Set(CONS.dias_cerrados || []);
    const stockPorId = {}; for (const i of s.insumos) stockPorId[i.id] = i;
    let html = pedNav('produccion') + `<p class="lede">Cuánta salsa se consume según lo vendido, por día de semana. Para decidir cuánto producir hoy mirá el consumo esperado de los días que cubre la vida útil.</p>`;
    for (const p of DATA.producciones) {
      const e = pr[p.id]; if (!e) continue;
      const vida = p.vida_util.dias || 1; const prox = []; let f = hoy;
      while (prox.length < vida) { if (!cerrados.has(isoDow(f))) prox.push(f); f = addDias(f, 1); if (prox.length > 14) break; }
      const total = prox.reduce((a, d) => a + esperado(e, isoDow(d)), 0); const batches = total / Number(p.batch.cantidad);
      const ins = stockPorId[p.id]; const info = CONS.insumos[p.id];
      html += `<div class="card"><strong style="font-size:22px">${esc(p.nombre)}</strong><div class="meta" style="margin-top:10px">
        <div><span class="k">Hoy (${esc(DOW[isoDow(hoy)])})</span><span class="v">${fmt(esperado(e, isoDow(hoy)) / 1000)} kg</span></div>
        <div><span class="k">Promedio/día</span><span class="v">${fmt(e.general / 1000)} kg</span></div>
        <div><span class="k">${vida} día${vida === 1 ? '' : 's'} de vida útil</span><span class="v">${fmt(total / 1000)} kg · ${fmt(batches)} batch</span></div>
        <div><span class="k">Último conteo</span><span class="v">${ins && ins.ultimo_cantidad != null && info ? `${fmt(ins.ultimo_cantidad)} ${esc(ins.unidad)} (${esc(fechaCorta(ins.ultimo_fecha))})` : '—'}</span></div>
      </div><p class="lede" style="margin:10px 0 0">Por día: ${[1, 3, 4, 5, 6, 7].map((w) => `${DOW[w].slice(0, 3)} ${fmt(esperado(e, w) / 1000)}`).join(' · ')} kg. Vida útil: ${esc(p.vida_util.texto)}.</p>
      <a class="btn secondary small" href="#/produccion/${esc(p.id)}">Abrir receta y escalar</a></div>`;
    }
    app.innerHTML = html;
  }

  function renderVentas({ v, hoy }) {
    const fechas = (v.dias || []).map((d) => d.fecha).sort().slice(-7);
    const prodNombre = (it) => it.tipo === 'cocina' ? (byId(DATA.productos, it.destino_id) || {}).nombre || it.producto_pos : it.producto_pos;
    const porProd = {}; const dias = [...new Set((v.items || []).map((i) => i.fecha))].sort();
    for (const it of (v.items || [])) { if (it.tipo === 'ignorar') continue; const k = prodNombre(it); porProd[k] = porProd[k] || { tipo: it.tipo, porDia: {} }; porProd[k].porDia[it.fecha] = (porProd[k].porDia[it.fecha] || 0) + Number(it.cantidad); }
    const orden = ['cocina', 'bebida', 'trago', null];
    const nombres = Object.keys(porProd).sort((a, b) => orden.indexOf(porProd[a].tipo) - orden.indexOf(porProd[b].tipo) || a.localeCompare(b));
    let html = pedNav('ventas') + `<p class="lede">Ventas por producto según los reportes del sistema: últimos 7 días con reporte, promedio diario y promedio por día de semana (sobre ${dias.length} días).</p>`;
    html += `<div class="card"><div class="scrollx"><table class="hist"><thead><tr><th>Producto</th>` + fechas.map((f) => `<th class="q">${esc(fechaCorta(f))}</th>`).join('') + `<th class="q">Prom</th><th class="q">Vie</th><th class="q">Sáb</th><th class="q">Dom</th></tr></thead><tbody>` +
      nombres.map((n) => { const p = porProd[n]; const prm = promedios({ ...Object.fromEntries(dias.map((d) => [d, { x: p.porDia[d] || 0 }])) }, dias).x;
        return `<tr><td><b>${esc(n)}</b><br><span class="sub">${esc(p.tipo || 'sin asignar')}</span></td>` + fechas.map((f, i) => `<td class="q ${i === fechas.length - 1 ? 'ult' : ''}">${p.porDia[f] != null ? fmt(p.porDia[f]) : '<span class="dash">—</span>'}</td>`).join('') +
          `<td class="q">${fmt(prm.general)}</td><td class="q">${prm.dow[5] != null ? fmt(prm.dow[5]) : '—'}</td><td class="q">${prm.dow[6] != null ? fmt(prm.dow[6]) : '—'}</td><td class="q">${prm.dow[7] != null ? fmt(prm.dow[7]) : '—'}</td></tr>`; }).join('') + `</tbody></table></div></div>`;
    const ult = [...(v.dias || [])].sort((a, b) => a.fecha < b.fecha ? 1 : -1).slice(0, 7);
    html += `<h2>Caja por día</h2><div class="card"><table><tbody>` + ult.map((d) => `<tr><td><b>${esc(fechaLarga(d.fecha))}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${d.pedidos != null ? `${fmt(d.pedidos)} pedidos · ` : ''}efectivo $ ${fmt(d.efectivo)} · MP $ ${fmt(d.mercado)}</span></td><td class="q">$ ${fmt(d.total)}</td></tr>`).join('') + `</tbody></table></div>`;
    app.innerHTML = html;
  }

  // ---------- 7. stock · conteo ----------
  const groupByRubro = (insumos) => {
    const out = [];
    for (const i of insumos) {
      let g = out.find((x) => x.rubro === i.rubro);
      if (!g) { g = { rubro: i.rubro, items: [] }; out.push(g); }
      g.items.push(i);
    }
    return out;
  };

  async function renderStock() {
    app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Stock</h1><p class="msg">Cargando…</p>`;
    let stock;
    try { stock = await API.stockGet(); }
    catch (e) { app.innerHTML = `<a class="back" href="#/">‹ Inicio</a><h1>Stock</h1><div class="status err">${errorMsg(e)}</div>`; return; }

    const fecha0 = hoyISO();
    let html = `<a class="back" href="#/">‹ Inicio</a><h1>Stock</h1>
      <div class="btnrow three"><a class="btn secondary small" href="#/stock/ver">Ver stock</a><a class="btn secondary small" href="#/stock/pedido">Pedido sugerido</a><a class="btn secondary small" href="#/stock/minimos">Mínimos</a></div>
      <div class="card">
        <label class="field"><span>Fecha del conteo</span><input id="fecha" type="date" value="${fecha0}"></label>
        <p class="lede" style="margin:0">Contar en la unidad indicada. Se guarda solo lo que completes; lo vacío no se toca.</p>
      </div>`;
    for (const g of groupByRubro(stock.insumos)) {
      html += `<h2>${esc(g.rubro)}</h2><div class="card">` + g.items.map((i) => `
        <div class="stockrow" data-id="${esc(i.id)}">
          <div><div class="name">${esc(i.nombre)}</div>
            <div class="sub">${esc(i.unidad)}${i.ultimo_fecha ? ` · último ${esc(fechaCorta(i.ultimo_fecha))}: ${fmt(i.ultimo_cantidad)}` : ' · sin conteo'}${i.minimo != null ? ` · mín. ${fmt(i.minimo)}` : ''}</div></div>
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="—"><div class="unit-big">${esc(i.unidad)}</div>
        </div>`).join('') + `</div>`;
    }
    html += `<div class="card"><div id="stock-status"></div><button class="btn" id="guardar">Guardar conteo</button></div>`;
    app.innerHTML = html;

    const fechaEl = document.getElementById('fecha');
    const status = document.getElementById('stock-status');
    const rows = Array.from(app.querySelectorAll('.stockrow'));
    let confirmado = false; // segundo toque en Guardar acepta los valores marcados como raros
    rows.forEach((r) => r.querySelector('input').addEventListener('input', () => { confirmado = false; }));

    async function cargarFecha() {
      try {
        const c = await API.conteoGet(fechaEl.value);
        rows.forEach((r) => {
          const it = (c.items || []).find((x) => x.insumo_id === r.dataset.id);
          r.querySelector('input').value = it ? String(it.cantidad).replace('.', ',') : '';
        });
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
    }
    fechaEl.addEventListener('change', cargarFecha);
    await cargarFecha();

    document.getElementById('guardar').addEventListener('click', async () => {
      const f = fechaEl.value;
      if (!f) { status.innerHTML = `<div class="status err">Elegí la fecha.</div>`; return; }
      const items = [];
      for (const r of rows) {
        const raw = r.querySelector('input').value.trim();
        if (raw === '') continue;
        const c = num(raw);
        if (c == null || c < 0) { status.innerHTML = `<div class="status err">Cantidad inválida en ${esc(r.querySelector('.name').textContent)}.</div>`; return; }
        items.push({ insumo_id: r.dataset.id, cantidad: c });
      }
      if (!items.length) { status.innerHTML = `<div class="status err">No hay cantidades cargadas.</div>`; return; }
      // Aviso si un valor no tiene sentido para la unidad (gramos cargados como kilos, o al revés). No bloquea.
      const raras = [];
      for (const r of rows) {
        const raw = r.querySelector('input').value.trim(); if (raw === '') continue;
        const v = num(raw), u = r.querySelector('.unit-big').textContent.trim().toLowerCase(), nombre = r.querySelector('.name').textContent;
        if (u === 'g' && v > 0 && v < 5) raras.push(`${nombre}: ${raw} g. Se cuenta en gramos, ¿no serán ${fmt(v * 1000)} g?`);
        else if (u !== 'g' && v > 200) raras.push(`${nombre}: ${raw} ${u}. ¿Seguro? La unidad es ${u}.`);
      }
      if (raras.length && !confirmado) {
        confirmado = true;
        status.innerHTML = `<div class="warn"><span class="k">Revisá estos valores</span><ul class="plain" style="margin:6px 0 10px">${raras.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>Corregilos y volvé a guardar, o tocá Guardar conteo de nuevo para guardarlos igual.</div>`;
        return;
      }
      confirmado = false;
      const btn = document.getElementById('guardar');
      btn.disabled = true;
      try {
        await API.conteoGuardar(f, items);
        status.innerHTML = `<div class="status ok">Conteo guardado: ${items.length} insumos para ${esc(fechaLarga(f))}.</div>`;
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
      finally { btn.disabled = false; }
    });
  }

  // ---------- 7b. stock · ver (consulta, solo lectura) ----------
  async function renderVerStock() {
    app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Ver stock</h1><p class="msg">Cargando…</p>`;
    let h;
    try { h = await API.stockHistorial(4); }
    catch (e) { app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Ver stock</h1><div class="status err">${errorMsg(e)}</div>`; return; }

    const fechas = h.fechas || [];
    let html = `<a class="back" href="#/stock">‹ Stock</a><h1>Ver stock</h1>`;
    if (!fechas.length) {
      html += `<div class="card"><p class="msg" style="padding:12px 0">Todavía no hay ningún conteo cargado.</p></div>`;
      app.innerHTML = html; return;
    }
    const bajos = h.insumos.filter((i) => i.minimo != null && i.conteos[fechas[0]] != null && Number(i.conteos[fechas[0]]) < Number(i.minimo)).length;
    html += `<p class="lede">Último conteo: <b>${esc(fechaLarga(fechas[0]))}</b>. Columnas: últimos ${fechas.length} conteos, del más reciente al más viejo.${bajos ? ` En bordó, <b>${bajos}</b> por debajo del mínimo.` : ''}</p>`;
    for (const g of groupByRubro(h.insumos)) {
      html += `<h2>${esc(g.rubro)}</h2><div class="card"><div class="scrollx"><table class="hist"><thead><tr><th>Insumo</th>` +
        fechas.map((f) => `<th class="q">${esc(fechaCorta(f))}</th>`).join('') + `<th class="q">Mín.</th></tr></thead><tbody>` +
        g.items.map((i) => {
          const ult = i.conteos[fechas[0]];
          const low = i.minimo != null && ult != null && Number(ult) < Number(i.minimo);
          return `<tr class="${low ? 'low' : ''}"><td><b>${esc(i.nombre)}</b><br><span class="sub">${esc(i.unidad)}</span></td>` +
            fechas.map((f, idx) => `<td class="q ${idx === 0 ? 'ult' : ''}">${i.conteos[f] != null ? fmt(i.conteos[f]) : '<span class="dash">—</span>'}</td>`).join('') +
            `<td class="q min">${i.minimo != null ? fmt(i.minimo) : '<span class="dash">—</span>'}</td></tr>`;
        }).join('') + `</tbody></table></div></div>`;
    }
    app.innerHTML = html;
  }

  // ---------- 8. stock · pedido sugerido ----------
  async function renderPedido() {
    app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Pedido sugerido</h1><p class="msg">Cargando…</p>`;
    let stock;
    try { stock = await API.stockGet(); }
    catch (e) { app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Pedido sugerido</h1><div class="status err">${errorMsg(e)}</div>`; return; }

    const conMin = stock.insumos.filter((i) => i.minimo != null);
    const sinConteo = conMin.filter((i) => i.ultimo_cantidad == null);
    const bajos = conMin.filter((i) => i.ultimo_cantidad != null && Number(i.ultimo_cantidad) < Number(i.minimo));
    const ultimaFecha = stock.fechas && stock.fechas[0];

    let html = `<a class="back" href="#/stock">‹ Stock</a><h1>Pedido sugerido</h1>
      <p class="lede">Se arma con el último conteo de cada insumo${ultimaFecha ? ` (último: ${esc(fechaLarga(ultimaFecha))})` : ''} y muestra solo lo que está por debajo del mínimo.</p>`;
    if (!conMin.length) {
      html += `<div class="status err">No hay mínimos cargados. Cargalos en <a class="link" href="#/stock/minimos">Mínimos</a>.</div>`;
    } else if (!bajos.length) {
      html += `<div class="card"><p class="msg" style="padding:12px 0">Nada por debajo del mínimo.</p></div>`;
    } else {
      for (const g of groupByRubro(bajos)) {
        html += `<h2>${esc(g.rubro)}</h2><div class="card pedido"><table><tbody>` + g.items.map((i) => `
          <tr><td><b>${esc(i.nombre)}</b><br><span class="sub" style="color:var(--gray);font-size:14px">${esc(i.unidad)} · tiene ${fmt(i.ultimo_cantidad)} · mín. ${fmt(i.minimo)}</span></td>
          <td class="q">${fmt(Number(i.minimo) - Number(i.ultimo_cantidad))}<span class="u"> ${esc(i.unidad)}</span></td></tr>`).join('') + `</tbody></table></div>`;
      }
    }
    if (sinConteo.length) html += `<p class="lede">${sinConteo.length} insumos con mínimo pero sin ningún conteo todavía.</p>`;
    app.innerHTML = html;
  }

  // ---------- 9. stock · mínimos (PIN) ----------
  async function renderMinimos() {
    app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Mínimos</h1><p class="msg">Cargando…</p>`;
    let stock, estado;
    try { [stock, estado] = await Promise.all([API.stockGet(), API.pinEstado()]); }
    catch (e) { app.innerHTML = `<a class="back" href="#/stock">‹ Stock</a><h1>Mínimos</h1><div class="status err">${errorMsg(e)}</div>`; return; }
    if (!estado.definido) return renderDefinirPin(() => renderMinimos());

    let html = `<a class="back" href="#/stock">‹ Stock</a><h1>Mínimos</h1>
      <p class="lede">Cantidad por debajo de la cual hay que reponer, en la unidad de cada insumo. Vacío significa sin mínimo.</p>`;
    for (const g of groupByRubro(stock.insumos)) {
      html += `<h2>${esc(g.rubro)}</h2><div class="card">` + g.items.map((i) => `
        <div class="stockrow" data-id="${esc(i.id)}">
          <div><div class="name">${esc(i.nombre)}</div><div class="sub">${esc(i.unidad)}</div></div>
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="—" value="${i.minimo != null ? esc(String(i.minimo).replace('.', ',')) : ''}">
        </div>`).join('') + `</div>`;
    }
    html += `<div class="card">
      <label class="field"><span>PIN</span><input id="pin" type="password" inputmode="numeric" autocomplete="off" value="${esc(API.pin.get())}"></label>
      <div id="min-status"></div><button class="btn" id="guardar">Guardar mínimos</button></div>`;
    app.innerHTML = html;

    const status = document.getElementById('min-status');
    document.getElementById('guardar').addEventListener('click', async () => {
      const p = document.getElementById('pin').value.trim();
      if (!p) { status.innerHTML = `<div class="status err">Ingresá el PIN.</div>`; return; }
      const items = [];
      for (const r of app.querySelectorAll('.stockrow')) {
        const raw = r.querySelector('input').value.trim();
        if (raw !== '' && (num(raw) == null || num(raw) < 0)) { status.innerHTML = `<div class="status err">Mínimo inválido en ${esc(r.querySelector('.name').textContent)}.</div>`; return; }
        items.push({ insumo_id: r.dataset.id, minimo: raw === '' ? null : num(raw) });
      }
      const btn = document.getElementById('guardar');
      btn.disabled = true;
      try {
        await API.minimosGuardar(p, items);
        API.pin.set(p);
        status.innerHTML = `<div class="status ok">Mínimos guardados.</div>`;
      } catch (e) {
        if (e.code === 'PIN_INCORRECTO') API.pin.clear();
        status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`;
      } finally { btn.disabled = false; }
    });
  }

  function notFound(what) {
    app.innerHTML = `<p class="msg error">${esc(what)} no encontrado.</p><p class="msg"><a href="#/">Volver al inicio</a></p>`;
  }

  // ---------- arranque ----------
  Promise.all([
    fetch('recetas.json', { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch('consumos.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null)
  ])
    .then(([d, c]) => { DATA = d; CONS = c; route(); })
    .catch((err) => {
      app.innerHTML = `<p class="msg error">No se pudo cargar recetas.json (${esc(err.message)}).</p>
        <p class="msg">La web tiene que abrirse desde un servidor HTTP, no con doble clic sobre el archivo. Ver README.md.</p>`;
    });

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && parseHash().section === 'dia' && !parseHash().id) route(); });
})();
