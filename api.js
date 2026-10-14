/* FLAMA · Cocina — acceso a Supabase sin librerías: llamadas RPC a las funciones flama_*.
 * Ninguna tabla se lee ni escribe directo; todo pasa por las funciones de la base. */
(function () {
  'use strict';
  const cfg = window.FLAMA_CONFIG || {};

  async function rpc(fn, params) {
    const r = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'apikey': cfg.supabaseAnonKey,
        'Authorization': `Bearer ${cfg.supabaseAnonKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(params || {})
    });
    let body = null;
    try { body = await r.json(); } catch (_) { /* sin cuerpo */ }
    if (!r.ok) {
      const msg = (body && (body.message || body.error || body.hint)) || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.code = /PIN_INCORRECTO/.test(msg) ? 'PIN_INCORRECTO'
        : /PIN_INVALIDO/.test(msg) ? 'PIN_INVALIDO'
        : 'ERROR';
      throw err;
    }
    return body;
  }

  // PIN de carga: se guarda solo en esta pestaña, la base lo verifica en cada guardado.
  const pin = {
    get: () => { try { return sessionStorage.getItem('flama_pin') || ''; } catch (_) { return ''; } },
    set: (v) => { try { sessionStorage.setItem('flama_pin', v); } catch (_) { /* sin storage */ } },
    clear: () => { try { sessionStorage.removeItem('flama_pin'); } catch (_) { /* sin storage */ } }
  };

  window.FLAMA_API = {
    pin,
    pinEstado: () => rpc('flama_pin_estado'),
    pinSet: (actual, nuevo) => rpc('flama_pin_set', { p_actual: actual || null, p_nuevo: nuevo }),
    planGet: (fecha) => rpc('flama_plan_get', { p_fecha: fecha }),
    planGuardar: (p, fecha, nota, items) => rpc('flama_plan_guardar', { p_pin: p, p_fecha: fecha, p_nota: nota, p_items: items }),
    itemMarcar: (id, hecho) => rpc('flama_item_marcar', { p_id: id, p_hecho: hecho }),
    stockGet: () => rpc('flama_stock_get'),
    stockHistorial: (n) => rpc('flama_stock_historial', { p_n: n || 4 }),
    conteoGet: (fecha) => rpc('flama_conteo_get', { p_fecha: fecha }),
    conteoGuardar: (fecha, items) => rpc('flama_conteo_guardar', { p_fecha: fecha, p_items: items }),
    minimosGuardar: (p, items) => rpc('flama_minimos_guardar', { p_pin: p, p_items: items })
  };
})();
