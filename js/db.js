// db.js — IndexedDB. Fuente de verdad local.
//
// Todo el esquema esta preparado para sincronizar desde el dia uno:
//   id        UUID generado en cliente -> las inserciones nunca colisionan
//   updatedAt para resolver ediciones (gana la mas reciente)
//   deletedAt tombstone; no borramos filas, las marcamos
//   dirty     1 = pendiente de empujar al servidor (IndexedDB no indexa booleanos)
//   syncedSeq numero de secuencia que asigno el servidor al confirmarla

const DB_NAME = 'trimtimer';
const DB_VERSION = 1;

let _db = null;

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback para contextos no seguros (http en LAN, por ejemplo).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function open() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('solves')) {
        const s = db.createObjectStore('solves', { keyPath: 'id' });
        s.createIndex('sessionId', 'sessionId');
        s.createIndex('createdAt', 'createdAt');
        s.createIndex('dirty', 'dirty');
        s.createIndex('sessionCreated', ['sessionId', 'createdAt']);
      }

      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- meta (clave/valor suelto) ---------- */

export async function getMeta(key, fallback = null) {
  await open();
  const row = await wrap(tx('meta').get(key));
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  await open();
  return wrap(tx('meta', 'readwrite').put({ key, value }));
}

/* ---------- sesiones ---------- */

export function newSession(name) {
  const now = Date.now();
  return {
    id: uuid(),
    name: name || 'Sesion 1',
    event: '333',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: 1,
    syncedSeq: null,
  };
}

export async function putSession(session) {
  await open();
  return wrap(tx('sessions', 'readwrite').put(session));
}

export async function listSessions() {
  await open();
  const all = await wrap(tx('sessions').getAll());
  return all.filter((s) => !s.deletedAt).sort((a, b) => a.createdAt - b.createdAt);
}

/** Devuelve la sesion activa, creando una por defecto si no hay ninguna. */
export async function ensureSession() {
  const sessions = await listSessions();
  let activeId = await getMeta('activeSessionId');

  let active = sessions.find((s) => s.id === activeId);
  if (!active) {
    active = sessions[0];
  }
  if (!active) {
    active = newSession('Sesion 1');
    await putSession(active);
  }
  if (active.id !== activeId) {
    await setMeta('activeSessionId', active.id);
  }
  return active;
}

/* ---------- solves ---------- */

export function newSolve({ sessionId, ms, scramble, event = '333' }) {
  const now = Date.now();
  return {
    id: uuid(),
    sessionId,
    event,
    ms,                 // tiempo CRUDO en milisegundos, sin penalizacion aplicada
    penalty: 'none',    // 'none' | '+2' | 'DNF'
    scramble,
    comment: '',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    dirty: 1,
    syncedSeq: null,
  };
}

export async function putSolve(solve) {
  await open();
  return wrap(tx('solves', 'readwrite').put(solve));
}

export async function getSolve(id) {
  await open();
  return wrap(tx('solves').get(id));
}

/** Solves vivos de una sesion, del mas antiguo al mas reciente. */
export async function listSolves(sessionId) {
  await open();
  const range = IDBKeyRange.bound([sessionId, -Infinity], [sessionId, Infinity]);
  const all = await wrap(tx('solves').index('sessionCreated').getAll(range));
  return all.filter((s) => !s.deletedAt);
}

/** No borra: marca tombstone para que el borrado se propague al sincronizar. */
export async function softDeleteSolve(id) {
  const solve = await getSolve(id);
  if (!solve) return null;
  solve.deletedAt = Date.now();
  solve.updatedAt = solve.deletedAt;
  solve.dirty = 1;
  await putSolve(solve);
  return solve;
}

export async function setPenalty(id, penalty) {
  const solve = await getSolve(id);
  if (!solve) return null;
  solve.penalty = penalty;
  solve.updatedAt = Date.now();
  solve.dirty = 1;
  await putSolve(solve);
  return solve;
}

/** Todo lo pendiente de empujar (solves y sesiones). */
export async function pending() {
  await open();
  const solves = await wrap(tx('solves').index('dirty').getAll(IDBKeyRange.only(1)));
  const sessions = (await wrap(tx('sessions').getAll())).filter((s) => s.dirty === 1);
  return { solves, sessions };
}

/* ---------- almacenamiento persistente ---------- */

/**
 * Pide al navegador que NO desaloje este origen bajo presion de disco.
 * Chrome lo concede casi siempre a PWAs instaladas.
 */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  const already = await navigator.storage.persisted();
  const granted = already || (await navigator.storage.persist());
  return { supported: true, granted };
}

export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

/* ---------- export / import ---------- */

export async function exportAll() {
  await open();
  return {
    format: 'trimtimer-v1',
    exportedAt: new Date().toISOString(),
    sessions: await wrap(tx('sessions').getAll()),
    solves: await wrap(tx('solves').getAll()),
  };
}

/**
 * Importa de forma ADITIVA: nunca borra lo que ya hay.
 * Si un id coincide, gana el registro con updatedAt mas reciente.
 */
export async function importAll(data) {
  if (!data || data.format !== 'trimtimer-v1') {
    throw new Error('Formato no reconocido. Se esperaba trimtimer-v1.');
  }
  await open();

  const stats = { sessions: 0, solves: 0, skipped: 0 };

  const mergeInto = (storeName, rows) => new Promise((resolve, reject) => {
    const t = _db.transaction(storeName, 'readwrite');
    const store = t.objectStore(storeName);
    for (const row of rows || []) {
      const get = store.get(row.id);
      get.onsuccess = () => {
        const existing = get.result;
        if (!existing || (row.updatedAt || 0) > (existing.updatedAt || 0)) {
          store.put({ ...row, dirty: 1 });
          stats[storeName] = (stats[storeName] || 0) + 1;
        } else {
          stats.skipped++;
        }
      };
    }
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });

  await mergeInto('sessions', data.sessions);
  await mergeInto('solves', data.solves);
  return stats;
}
