// timer.js — maquina de estados del cronometro.
//
//   idle ──(pulsar)──> holding ──(550ms)──> ready ──(soltar)──> running
//     ^                   │                                        │
//     └───(soltar antes)──┘                   (pulsar cualquier cosa)
//     └────────────────────────────────────────────────────────────┘
//
// Dos reglas que importan:
//  1. El tiempo BUENO sale de restar dos marcas de performance.now(),
//     capturadas en el evento. Lo que se pinta en pantalla es cosmetico.
//  2. performance.now() y no Date.now(): el segundo da saltos si el
//     sistema sincroniza el reloj a mitad de resolucion.

const HOLD_MS = 550; // lo que hay que mantener pulsado antes de que se ponga verde

export class Timer {
  constructor({ onState, onTick, onResult } = {}) {
    this.state = 'idle';
    this.onState = onState || (() => {});
    this.onTick = onTick || (() => {});
    this.onResult = onResult || (() => {});

    this._holdTimeout = null;
    this._raf = null;
    this._startedAt = 0;
    this._blocked = false;  // true = esperando a que suelten tras parar
    this._enabled = true;
  }

  /** Se desactiva mientras hay un modal abierto o se escribe en un input. */
  setEnabled(on) {
    this._enabled = on;
    if (!on && this.state !== 'running') this._toIdle();
  }

  get isRunning() { return this.state === 'running'; }

  _set(state) {
    if (this.state === state) return;
    this.state = state;
    this.onState(state);
  }

  _toIdle() {
    clearTimeout(this._holdTimeout);
    this._holdTimeout = null;
    this._set('idle');
  }

  /* ---------- entradas ---------- */

  /** Dedo o tecla abajo. */
  press() {
    if (!this._enabled || this._blocked) return;

    if (this.state === 'running') {
      this._stop();
      this._blocked = true; // no dejamos que este mismo gesto arranque otra
      return;
    }

    if (this.state === 'idle') {
      this._set('holding');
      this._holdTimeout = setTimeout(() => this._set('ready'), HOLD_MS);
    }
  }

  /** Dedo o tecla arriba. */
  release() {
    if (this._blocked) { this._blocked = false; return; }
    if (!this._enabled) return;

    clearTimeout(this._holdTimeout);
    this._holdTimeout = null;

    if (this.state === 'ready') {
      this._start();
    } else if (this.state === 'holding') {
      this._set('idle'); // soltaron antes de tiempo
    }
  }

  /* ---------- arranque y parada ---------- */

  _start() {
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
    const ms = performance.now() - this._startedAt; // el valor que se guarda
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._set('idle');
    this.onTick(ms);
    this.onResult(ms);
  }

  /** Aborta sin registrar nada (por ejemplo al cambiar de sesion). */
  cancel() {
    cancelAnimationFrame(this._raf);
    this._raf = null;
    this._blocked = false;
    this._toIdle();
  }
}

/**
 * Conecta teclado y tactil a un Timer.
 * - Espacio como tecla principal; cualquier otra tecla solo para PARAR.
 * - preventDefault en espacio o la pagina hace scroll a cada pulsacion.
 */
export function bindInput(timer, surface) {
  const isTypingTarget = (el) =>
    el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.repeat) return;              // keydown se repite solo si mantienes la tecla

    if (e.code === 'Space') {
      e.preventDefault();
      timer.press();
      return;
    }
    // Cualquier otra tecla para el cronometro, pero no lo arranca.
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
      timer.press();
    });
    surface.addEventListener('pointerup', (e) => {
      e.preventDefault();
      timer.release();
    });
    surface.addEventListener('pointercancel', () => timer.release());
    // Evita el menu contextual al mantener pulsado en movil.
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

export { HOLD_MS };
