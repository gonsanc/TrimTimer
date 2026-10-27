// sound.js — pitidos de inspeccion.
//
// Sintetizados con Web Audio, sin ficheros de audio que cargar ni cachear.
// El AudioContext hay que crearlo o reanudarlo desde un gesto del usuario
// o los navegadores moviles lo dejan suspendido en silencio.

let ctx = null;
let enabled = true;

export function setEnabled(on) { enabled = on; }
export function isEnabled() { return enabled; }

/** Llamar desde un gesto real (la primera pulsacion del espacio). */
export function unlock() {
  if (!enabled) return;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* sin audio, la app funciona igual */ }
}

function tone(freq, durationMs, delayMs = 0) {
  if (!enabled || !ctx || ctx.state !== 'running') return;

  const t0 = ctx.currentTime + delayMs / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'sine';
  osc.frequency.value = freq;

  // Rampas cortas en vez de cortes secos: un corte en seco suena a chasquido.
  const dur = durationMs / 1000;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(0.18, t0 + 0.012);
  gain.gain.setValueAtTime(0.18, t0 + dur - 0.03);
  gain.gain.linearRampToValueAtTime(0, t0 + dur);

  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** Aviso de los 8 segundos: un pitido. */
export function cue8() { tone(880, 120); }

/** Aviso de los 12 segundos: dos pitidos, mas agudo. */
export function cue12() { tone(1180, 110); tone(1180, 110, 160); }

/** Se acabaron los 15: zona de +2. */
export function cueOver() { tone(440, 260); }
