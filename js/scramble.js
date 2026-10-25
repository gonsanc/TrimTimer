// scramble.js — scrambles de ESTADO aleatorio via cubing.js, con prefetch.
//
// Por que cubing.js y no 20 movimientos al azar: un scramble de movimientos
// aleatorios esta sesgado y de vez en cuando deja el cubo medio resuelto.
// La WCA genera un estado aleatorio del cubo y lo resuelve, lo que reparte
// uniformemente sobre todos los estados posibles.
//
// PENDIENTE antes de produccion / Capacitor: vendorizar la libreria.
// Hoy tira de la CDN, que es comoda pero tambien es cadena de suministro,
// y dentro del WebView de Capacitor no habria red garantizada. Descarga el
// bundle una vez, metelo en vendor/ y cambia el import de abajo.
const CDN = 'https://cdn.cubing.net/v0/js/cubing/scramble';

let _randomScrambleForEvent = null;
let _loadFailed = false;
let _queue = [];        // scrambles ya calculados, listos para servir
let _inFlight = null;   // promesa del que se esta calculando ahora

const PREFETCH = 2;     // cuantos tener listos por delante

/* ---------- carga de la libreria ---------- */

async function loadLib() {
  if (_randomScrambleForEvent || _loadFailed) return _randomScrambleForEvent;
  try {
    const mod = await import(/* @vite-ignore */ CDN);
    _randomScrambleForEvent = mod.randomScrambleForEvent;
  } catch (err) {
    console.warn('[scramble] cubing.js no disponible, se usa el generador de respaldo.', err);
    _loadFailed = true;
  }
  return _randomScrambleForEvent;
}

/** true si estamos sirviendo scrambles WCA de verdad. */
export function isRandomState() {
  return !!_randomScrambleForEvent && !_loadFailed;
}

/* ---------- respaldo: movimientos aleatorios ---------- */

const FACES = ['U', 'D', 'L', 'R', 'F', 'B'];
const OPPOSITE = { U: 'D', D: 'U', L: 'R', R: 'L', F: 'B', B: 'F' };
const SUFFIX = ['', "'", '2'];

/**
 * Respaldo SOLO para cuando cubing.js no carga (sin red, CDN caida).
 * NO es un scramble WCA: evita repetir cara y cara opuesta consecutiva,
 * pero sigue siendo random-move y por tanto sesgado.
 */
function fallbackScramble(len = 20) {
  const moves = [];
  let prev = null;
  let prevPrev = null;

  while (moves.length < len) {
    const face = FACES[(Math.random() * FACES.length) | 0];
    if (face === prev) continue;
    if (face === OPPOSITE[prev] && prevPrev === face) continue;
    moves.push(face + SUFFIX[(Math.random() * 3) | 0]);
    prevPrev = prev;
    prev = face;
  }
  return moves.join(' ');
}

/* ---------- generacion + cola de prefetch ---------- */

async function generate(event = '333') {
  const fn = await loadLib();
  if (!fn) return fallbackScramble();
  try {
    const alg = await fn(event);
    return alg.toString();
  } catch (err) {
    console.warn('[scramble] fallo generando, se usa el de respaldo.', err);
    return fallbackScramble();
  }
}

/**
 * Rellena la cola en segundo plano.
 * El primer scramble siempre tarda: el solver tiene que montar sus tablas
 * de busqueda. A partir de ahi vamos calculando el siguiente mientras el
 * usuario resuelve el actual, asi que nunca se espera.
 */
function topUp(event = '333') {
  if (_queue.length >= PREFETCH || _inFlight) return;
  _inFlight = generate(event)
    .then((s) => { _queue.push(s); })
    .catch(() => {})
    .finally(() => { _inFlight = null; topUp(event); });
}

/** Arranca el prefetch cuanto antes, sin bloquear el arranque de la app. */
export function warmUp(event = '333') {
  topUp(event);
}

/** Siguiente scramble. Instantaneo si la cola tiene stock. */
export async function next(event = '333') {
  if (_queue.length) {
    const s = _queue.shift();
    topUp(event);
    return s;
  }
  // Cola vacia (primera vez): esperamos este y encolamos los siguientes.
  const s = await generate(event);
  topUp(event);
  return s;
}
