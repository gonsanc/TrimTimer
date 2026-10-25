// stats.js — medias al estilo WCA.
//
// Las reglas que casi todo el mundo implementa mal:
//   - El +2 se aplica ANTES de promediar.
//   - El DNF vale infinito: en un ao5 se va con el recorte del peor,
//     asi que UN DNF da media valida. DOS DNFs dan DNF.
//   - mo3 es media simple sin recortes: cualquier DNF la invalida.

export const DNF = Infinity;

/** Tiempo efectivo de un solve: crudo + penalizacion. */
export function effective(solve) {
  if (!solve) return null;
  if (solve.penalty === 'DNF') return DNF;
  return solve.ms + (solve.penalty === '+2' ? 2000 : 0);
}

/** Cuantos se recortan por cada extremo en una media de n. */
function trimCount(n) {
  if (n < 3) return 0;
  if (n <= 12) return 1;          // ao5 y ao12 recortan 1 por lado
  return Math.ceil(n * 0.05);     // convencion para ao25/ao50/ao100: 5% por lado
}

/**
 * Media recortada de una lista de tiempos efectivos.
 * Devuelve un numero, DNF (Infinity) o null si no hay suficientes.
 */
export function trimmedAverage(times) {
  const n = times.length;
  if (n < 3) return null;

  const trim = trimCount(n);
  const sorted = [...times].sort((a, b) => a - b);
  const middle = sorted.slice(trim, n - trim);

  // Si despues de recortar sigue quedando un DNF, la media es DNF.
  if (middle.some((t) => t === DNF)) return DNF;

  const sum = middle.reduce((a, b) => a + b, 0);
  return sum / middle.length;
}

/** Media simple (mo3): sin recortes, cualquier DNF la invalida. */
export function mean(times) {
  if (!times.length) return null;
  if (times.some((t) => t === DNF)) return DNF;
  return times.reduce((a, b) => a + b, 0) / times.length;
}

/** aoN sobre los ULTIMOS n solves de la lista. null si no hay n todavia. */
export function aoN(solves, n) {
  if (solves.length < n) return null;
  return trimmedAverage(solves.slice(-n).map(effective));
}

export function moN(solves, n) {
  if (solves.length < n) return null;
  return mean(solves.slice(-n).map(effective));
}

/**
 * Mejor aoN de toda la sesion (ventana deslizante).
 * Incremental de verdad seria mas fino, pero con unos miles de solves
 * esto tarda microsegundos y es mucho mas facil de verificar.
 */
export function bestAoN(solves, n) {
  if (solves.length < n) return null;
  const times = solves.map(effective);
  let best = null;
  for (let i = 0; i + n <= times.length; i++) {
    const avg = trimmedAverage(times.slice(i, i + n));
    if (avg === null || avg === DNF) continue;
    if (best === null || avg < best) best = avg;
  }
  return best;
}

/** Mejor single valido de la sesion. */
export function bestSingle(solves) {
  let best = null;
  for (const s of solves) {
    const t = effective(s);
    if (t === DNF) continue;
    if (best === null || t < best) best = t;
  }
  return best;
}

export function worstSingle(solves) {
  let worst = null;
  for (const s of solves) {
    const t = effective(s);
    if (t === DNF) continue;
    if (worst === null || t > worst) worst = t;
  }
  return worst;
}

/** Media de la sesion entera, descartando DNFs (no es una media WCA). */
export function sessionMean(solves) {
  const valid = solves.map(effective).filter((t) => t !== DNF);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

export function summary(solves) {
  return {
    count: solves.length,
    dnf: solves.filter((s) => s.penalty === 'DNF').length,
    best: bestSingle(solves),
    worst: worstSingle(solves),
    mean: sessionMean(solves),
    mo3: moN(solves, 3),
    ao5: aoN(solves, 5),
    ao12: aoN(solves, 12),
    ao100: aoN(solves, 100),
    bestAo5: bestAoN(solves, 5),
    bestAo12: bestAoN(solves, 12),
  };
}

/* ---------- formato ---------- */

/**
 * 1234 -> "1.23"   |   65432 -> "1:05.43"   |   DNF -> "DNF"
 * Centesimas, como marca la WCA.
 */
export function fmt(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms === DNF) return 'DNF';

  const total = Math.floor(ms / 10); // a centesimas, truncando
  const cs = total % 100;
  const totalSec = Math.floor(total / 100);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60);

  const cc = String(cs).padStart(2, '0');
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${cc}`;
  return `${s}.${cc}`;
}

/** Como fmt pero anotando la penalizacion: "12.34+" o "DNF". */
export function fmtSolve(solve) {
  if (!solve) return '—';
  if (solve.penalty === 'DNF') return 'DNF';
  const base = fmt(solve.ms + (solve.penalty === '+2' ? 2000 : 0));
  return solve.penalty === '+2' ? `${base}+` : base;
}
