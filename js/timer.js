// timer.js — maquina de estados del cronometro, con inspeccion WCA opcional.
//
// Sin inspeccion:
//   idle ──(pulsar)──> holding ──(550ms)──> ready ──(soltar)──> running
//
// Con inspeccion:
//   idle ──(pulsar)──> inspecting ──(pulsar)──> holding ──(550ms)──> ready
//                           ^                      │                   │
//                           └───(soltar antes)─────┘        (soltar)───┘──> running
//
// Reglas de inspeccion (WCA A3):
//   - 15 segundos; avisos a los 8 y a los 12.
//   - Arrancar entre 15 y 17  -> +2
//   - Arrancar pasados los 17 -> DNF
//
// Dos cosas que importan del cronometro en si:
//  1. El tiempo BUENO sale de restar dos marcas de performance.now()
//     capturadas en el evento. Lo que se pinta es cosmetico.
//  2. performance.now() y no Date.now(): el segundo da saltos si el
//     sistema sincroniza el reloj a mitad de resolucion.

const HOLD_MS = 550;           // mantener pulsado antes de ponerse verde
const INSPECTION_MS = 15000;
const CUE_8_MS = 8000;
const CUE_12_MS = 12000;
const PLUS2_LIMIT_MS = 17000;  // pasado esto, DNF

/** Penalizacion que corresponde a un tiempo de inspeccion dado. */
export function inspectionPenalty(elapsed) {
  if (elapsed <= INSPECTION_MS) return 'none';
  if (elapsed <= PLUS2_LIMIT_MS) return '+2';
  return 'DNF';
}

export class Timer {
  constructor({ onState, onTick, onResult, onInspection, onCue } = {}) {
    this.state = 'idle';
    this.onState = onState || (() => {});
    this.onTick = onTick || (() => {});
    this.onResult = onResult || (() => {});
    this.onInspection = onInspection || (() => {});
    this.onCue = onCue || (() => {});

    this.inspectionEnabled = false;

    this._holdTimeout = null;
    this._raf = null;
    this._inspectionRaf = null;
    this._startedAt = 0;
    this._inspectionStartedAt = 0;
    this._cuesFired = new Set();
    this._pendingPenalty = 'none';
    this._blocked = false;   // esperando a que suelten tras parar o tras abrir inspeccion
    this._enabled = true;
  }

  setInspection(on) {
    this.inspectionEnabled = !!on;
    if (!on && this.state === 'inspecting') this.cancel();
  }

  /** Se desactiva mientras hay un modal abierto. */
  setEnabled(on) {
    this._enabled = on;
    if (!on && this.state !== 'running') this.cancel();
  }

  get isRunning() { return this.state === 'running'; }
  get isInspecting() { return this.state === 'inspecting'; }

  _set(state) {
    if (this.state === state) return;
    this.state = state;
    this.onState(state);
  }

  /* ---------- entradas ---------- */

  press() {
    if (!this._enabled || this._blocked) return;

    if (this.state === 'running') {
      this._stop();
      this._blocked = true;   // este mismo gesto no puede arrancar otra cosa
      return;
    }

    if (this.state === 'idle') {
      if (this.inspectionEnabled) {
        this._startInspection();
        this._blocked = true; // el soltar de este gesto no cuenta como "armar"
      } else {
        this._arm();
      }
      return;
    }

    if (this.state === 'inspecting') {
      this._arm();
    }
  }

  release() {
    if (this._blocked) { this._blocked = false; return; }
    if (!this._enabled) return;

    clearTimeout(this._holdTimeout);
    this._holdTimeout = null;

    if (this.state === 'ready') {
      this._start();
    } else if (this.state === 'holding') {
      // Soltaron antes de tiempo: se vuelve a donde estaban.
      this._set(this._inspectionRaf ? 'inspecting' : 'idle');
    }
  }

  _arm() {
    this._set('holding');
    this._holdTimeout = setTimeout(() => this._set('ready'), HOLD_MS);
  }

  /* ---------- inspeccion ---------- */

  _startInspection() {
    this._inspectionStartedAt = performance.now();
    this._cuesFired.clear();
    this._set('inspecting');

    const loop = () => {
      if (this.state !== 'inspecting' && this.state !== 'holding' && this.state !== 'ready') return;

      const elapsed = performance.now() - this._inspectionStartedAt;

      if (elapsed >= CUE_8_MS && !this._cuesFired.has(8)) {
        this._cuesFired.add(8);
        this.onCue(8);
      }
      if (elapsed >= CUE_12_MS && !this._cuesFired.has(12)) {
        this._cuesFired.add(12);
        this.onCue(12);
      }
      if (elapsed >= INSPECTION_MS && !this._cuesFired.has(15)) {
        this._cuesFired.add(15);
        this.onCue(15);
      }

      const penalty = inspectionPenalty(elapsed);
      this.onInspection({
        elapsed,
        remaining: Math.max(0, INSPECTION_MS - elapsed),
        penalty,
        // Lo que se pinta: cuenta atras en segundos enteros, luego el aviso.
        label: penalty === 'none'
          ? String(Math.ceil((INSPECTION_MS - elapsed) / 1000))
          : penalty,
      });

      this._inspectionRaf = requestAnimationFrame(loop);
    };
    this._inspectionRaf = requestAnimationFrame(loop);
  }

  _stopInspection() {
    cancelAnimationFrame(this._inspectionRaf);
    this._inspectionRaf = null;
  }

  /* ---------- arranque y parada ---------- */

  _start() {
    // La penalizacion se fija en el instante de arrancar, no al parar.
    if (this._inspectionRaf) {
      this._pendingPenalty = inspectionPenalty(performance.now() - this._inspectionStartedAt);
      this._stopInspection();
    } else {
      this._pendingPenalty = 'none';
    }

    this._startedAt = performance.now();
    this._set('running');

    const loop = () => {
      if (this.state !== 'running') return;
      this.onTick(performance.now() - this._startedAt);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _stop() {
    const ms = performance.now() - this._startedAt;  // el valor que se guarda
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._set('idle');
    this.onTick(ms);
    this.onResult({ ms, penalty: this._pendingPenalty });
    this._pendingPenalty = 'none';
  }

  /** Aborta sin registrar nada. */
  cancel() {
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._stopInspection();
    clearTimeout(this._holdTimeout);
    this._holdTimeout = null;
    this._blocked = false;
    this._pendingPenalty = 'none';
    this._set('idle');
  }
}

/**
 * Conecta teclado y tactil a un Timer.
 * - Espacio como tecla principal; cualquier otra tecla solo PARA.
 * - Escape aborta la inspeccion.
 * - preventDefault en espacio o la pagina hace scroll a cada pulsacion.
 */
export function bindInput(timer, surface, { onFirstGesture } = {}) {
  let gestureDone = false;
  const firstGesture = () => {
    if (gestureDone) return;
    gestureDone = true;
    onFirstGesture?.();
  };

  const isTypingTarget = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.repeat) return;          // keydown se repite solo si mantienes la tecla

    if (e.key === 'Escape' && (timer.isInspecting || timer.state === 'holding')) {
      e.preventDefault();
      timer.cancel();
      return;
    }

    if (e.code === 'Space') {
      e.preventDefault();
      firstGesture();
      timer.press();
      return;
    }

    if (timer.isRunning && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      timer.press();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      timer.release();
    }
  });

  if (surface) {
    surface.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      firstGesture();
      timer.press();
    });
    surface.addEventListener('pointerup', (e) => {
      e.preventDefault();
      timer.release();
    });
    surface.addEventListener('pointercancel', () => timer.release());
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export { HOLD_MS, INSPECTION_MS, PLUS2_LIMIT_MS };
