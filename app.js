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
      case 'stock':
        topbarSub.textContent = 'Stock';
        return id === 'pedido' ? renderPedido() : id === 'minimos' ? renderMinimos() : renderStock();
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
      <div class="btnrow"><a class="btn secondary small" href="#/stock/pedido">Pedido sugerido</a><a class="btn secondary small" href="#/stock/minimos">Mínimos</a></div>
      <div class="card">
        <label class="field"><span>Fecha del conteo</span><input id="fecha" type="date" value="${fecha0}"></label>
        <p class="lede" style="margin:0">Contar en la unidad indicada. Se guarda solo lo que completes; lo vacío no se toca.</p>
      </div>`;
    for (const g of groupByRubro(stock.insumos)) {
      html += `<h2>${esc(g.rubro)}</h2><div class="card">` + g.items.map((i) => `
        <div class="stockrow" data-id="${esc(i.id)}">
          <div><div class="name">${esc(i.nombre)}</div>
            <div class="sub">${esc(i.unidad)}${i.ultimo_fecha ? ` · último ${esc(fechaCorta(i.ultimo_fecha))}: ${fmt(i.ultimo_cantidad)}` : ' · sin conteo'}${i.minimo != null ? ` · mín. ${fmt(i.minimo)}` : ''}</div></div>
          <input type="text" inputmode="decimal" autocomplete="off" placeholder="—">
        </div>`).join('') + `</div>`;
    }
    html += `<div class="card"><div id="stock-status"></div><button class="btn" id="guardar">Guardar conteo</button></div>`;
    app.innerHTML = html;

    const fechaEl = document.getElementById('fecha');
    const status = document.getElementById('stock-status');
    const rows = Array.from(app.querySelectorAll('.stockrow'));

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
      const btn = document.getElementById('guardar');
      btn.disabled = true;
      try {
        await API.conteoGuardar(f, items);
        status.innerHTML = `<div class="status ok">Conteo guardado: ${items.length} insumos para ${esc(fechaLarga(f))}.</div>`;
      } catch (e) { status.innerHTML = `<div class="status err">${errorMsg(e)}</div>`; }
      finally { btn.disabled = false; }
    });
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
  fetch('recetas.json', { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((d) => { DATA = d; route(); })
    .catch((err) => {
      app.innerHTML = `<p class="msg error">No se pudo cargar recetas.json (${esc(err.message)}).</p>
        <p class="msg">La web tiene que abrirse desde un servidor HTTP, no con doble clic sobre el archivo. Ver README.md.</p>`;
    });

  window.addEventListener('hashchange', route);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && parseHash().section === 'dia' && !parseHash().id) route(); });
})();
