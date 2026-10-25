// sync.js — cola de sincronizacion.
//
// FASE 1: la estructura esta entera (cola, debounce, disparadores, estado),
// pero sin endpoint configurado no se envia nada: los solves se quedan
// marcados como pendientes en local y no se pierde absolutamente nada.
// Cuando este el servidor de Oracle, se rellena `push()` y ya funciona.
//
// La regla que no se rompe: sincronizar NUNCA esta en el camino de la UI.
// Se graba en IndexedDB, se pinta, y la sincronizacion se lanza sin await.

import * as db from './db.js';

const DEBOUNCE_MS = 4000; // agrupa el solve con su posible +2/DNF posterior

let _timer = null;
let _running = false;
let _listeners = [];
let _state = { status: 'idle', pending: 0, lastSync: null, error: null };

export function onChange(fn) {
  _listeners.push(fn);
  fn(_state);
  return () => { _listeners = _listeners.filter((f) => f !== fn); };
}

function emit(patch) {
  _state = { ..._state, ...patch };
  _listeners.forEach((f) => f(_state));
}

export function getState() { return _state; }

async function refreshPending() {
  const { solves, sessions } = await db.pending();
  emit({ pending: solves.length + sessions.length });
  return solves.length + sessions.length;
}

/* ---------- configuracion del servidor ---------- */

export async function getConfig() {
  return {
    endpoint: await db.getMeta('syncEndpoint', ''),
    token: await db.getMeta('syncToken', ''),
    deviceId: await db.getMeta('deviceId', null),
  };
}

export async function setConfig({ endpoint, token }) {
  await db.setMeta('syncEndpoint', endpoint || '');
  await db.setMeta('syncToken', token || '');
  let deviceId = await db.getMeta('deviceId', null);
  if (!deviceId) {
    deviceId = db.uuid();
    await db.setMeta('deviceId', deviceId);
  }
  await refreshPending();
}

/* ---------- el intercambio ---------- */

/**
 * Un unico endpoint hace todo el trabajo:
 *   POST { token, deviceId, since, changes[] }  ->  { changes[], serverSeq }
 *
 * El orden lo marca `serverSeq`, asignado por el SERVIDOR, no el reloj del
 * cliente: si ordenas por timestamps de dispositivos con relojes desfasados
 * se pierden ediciones en silencio.
 */
async function exchange(cfg, payload) {
  const res = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`El servidor respondio ${res.status}`);
  return res.json();
}

export async function syncNow({ silent = false } = {}) {
  if (_running) return _state;
  const cfg = await getConfig();

  if (!cfg.endpoint) {
    await refreshPending();
    emit({ status: 'offline-only', error: null });
    return _state;
  }

  _running = true;
  if (!silent) emit({ status: 'syncing', error: null });

  try {
    const { solves, sessions } = await db.pending();
    const since = await db.getMeta('lastServerSeq', 0);

    const result = await exchange(cfg, {
      token: cfg.token,
      deviceId: cfg.deviceId,
      since,
      changes: { solves, sessions },
    });

    // Lo que llega de fuera: gana el updatedAt mas reciente.
    for (const row of result.changes?.sessions || []) {
      const local = (await db.listSessions()).find((s) => s.id === row.id);
      if (!local || (row.updatedAt || 0) > (local.updatedAt || 0)) {
        await db.putSession({ ...row, dirty: 0 });
      }
    }
    for (const row of result.changes?.solves || []) {
      const local = await db.getSolve(row.id);
      if (!local || (row.updatedAt || 0) > (local.updatedAt || 0)) {
        await db.putSolve({ ...row, dirty: 0 });
      }
    }

    // Marcamos como limpio SOLO lo que el servidor confirmo.
    for (const id of result.acked?.solves || []) {
      const s = await db.getSolve(id);
      if (s && s.updatedAt <= (result.ackedAt || Date.now())) {
        s.dirty = 0;
        s.syncedSeq = result.serverSeq;
        await db.putSolve(s);
      }
    }

    if (result.serverSeq != null) {
      await db.setMeta('lastServerSeq', result.serverSeq);
    }

    await refreshPending();
    emit({ status: 'ok', lastSync: Date.now(), error: null });
  } catch (err) {
    await refreshPending();
    emit({ status: 'error', error: err.message });
  } finally {
    _running = false;
  }

  return _state;
}

/** Lo que se llama tras cada cambio. Nunca se espera. */
export function schedule() {
  clearTimeout(_timer);
  _timer = setTimeout(() => syncNow({ silent: true }), DEBOUNCE_MS);
  refreshPending();
}

/** Fuerza el envio ya, sin esperar al debounce (boton manual). */
export function flush() {
  clearTimeout(_timer);
  return syncNow();
}

/* ---------- disparadores ---------- */

export function installTriggers() {
  // Al volver a la app: traerse lo del otro dispositivo.
  // Al irse: vaciar la cola. No usamos beforeunload, en movil no es fiable.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow({ silent: true });
    else flush();
  });

  window.addEventListener('online', () => syncNow({ silent: true }));

  refreshPending();
}
