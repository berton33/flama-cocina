/* FLAMA · Cocina
 * Toda la información (nombres, gramajes, procedimientos, notas) viene de recetas.json.
 * Este archivo solo sabe leer esa estructura y mostrarla.
 */
(function () {
  'use strict';

  const app = document.getElementById('app');
  const topbarSub = document.getElementById('topbar-sub');
  let DATA = null;

  // ---------- utilidades ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Redondeo a 1 decimal, formato es-AR (coma decimal).
  const fmt = (n) => {
    const r = Math.round(n * 10) / 10;
    return r.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
  };

  const byId = (list, id) => list.find((x) => x.id === id);

  // Un componente/ingrediente tiene unidad (g/ml) o unidad_pieza (feta, gotas, unidad).
  function qtyHtml(c, factor) {
    if (c.unidad_pieza) return `${fmt(c.cantidad)}<span class="u"> ${esc(c.unidad_pieza)}</span>`;
    const q = factor == null ? c.cantidad : c.cantidad * factor;
    return `${fmt(q)}<span class="u"> ${esc(c.unidad)}</span>`;
  }

  // ---------- rutas ----------
  function parseHash() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [section, id] = h.split('/');
    return { section: section || '', id: id || null };
  }

  function route() {
    if (!DATA) return;
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
      default:
        location.hash = '#/';
    }
  }

  // ---------- 1. inicio ----------
  function renderInicio() {
    app.innerHTML = `<div class="home">
      <a href="#/productos">Productos</a>
      <a href="#/produccion">Producción</a>
      <a href="#/notas">Notas</a>
    </div>`;
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

  // ---------- 3. producción ----------
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
      const val = parseFloat(String(input.value).replace(',', '.'));
      const total = isFinite(val) && val > 0 ? val : baseIngreso;
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
})();
