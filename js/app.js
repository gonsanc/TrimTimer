// app.js — cableado de todo.

import * as db from './db.js';
import * as stats from './stats.js';
import * as scramble from './scramble.js';
import * as sync from './sync.js';
import * as sound from './sound.js';
import { Timer, bindInput } from './timer.js';

const $ = (id) => document.getElementById(id);

const el = {
  time: $('time'),
  hint: $('hint'),
  surface: $('timer-surface'),
  scrambleText: $('scramble-text'),
  scrambleSource: $('scramble-source'),
  newScramble: $('new-scramble'),
  solveList: $('solve-list'),
  statsBox: $('stats'),
  sessionSelect: $('session-select'),
  newSession: $('new-session'),
  syncDot: $('sync-dot'),
  syncLabel: $('sync-label'),
  syncNow: $('sync-now'),
  modal: $('settings-modal'),
};

const state = {
  session: null,
  solves: [],
  scramble: '',
};

/* ================= cronometro ================= */

const timer = new Timer({
  onState: (s) => {
    el.time.classList.toggle('holding', s === 'holding');
    el.time.classList.toggle('ready', s === 'ready');
    el.time.classList.toggle('inspecting', s === 'inspecting');
    document.body.classList.toggle('running', s === 'running');
    document.body.classList.toggle('inspecting', s === 'inspecting' || s === 'holding' || s === 'ready');

    if (s === 'holding') el.hint.textContent = 'Sigue…';
    else if (s === 'ready') el.hint.textContent = 'Suelta';
    else if (s === 'inspecting') el.hint.textContent = 'Inspeccion — manten el espacio para armar · Esc cancela';
    else if (s === 'idle') {
      el.time.classList.remove('over');
      el.hint.textContent = timer.inspectionEnabled
        ? 'Pulsa espacio para empezar la inspeccion'
        : 'Manten el espacio hasta que se ponga verde';
    }
  },

  onTick: (ms) => { el.time.textContent = stats.fmt(ms); },

  // Durante la inspeccion el display es una cuenta atras, no un cronometro.
  onInspection: ({ label, penalty }) => {
    el.time.textContent = label;
    el.time.classList.toggle('over', penalty !== 'none');
  },

  onCue: (at) => {
    if (at === 8) sound.cue8();
    else if (at === 12) sound.cue12();
    else if (at === 15) sound.cueOver();
  },

  onResult: ({ ms, penalty }) => { void saveSolve(ms, penalty); },
});

// unlock() tiene que ir en un gesto real del usuario o el navegador
// deja el AudioContext suspendido y no suena nada en movil.
bindInput(timer, el.surface, { onFirstGesture: () => sound.unlock() });

async function saveSolve(ms, penalty = 'none') {
  const solve = db.newSolve({
    sessionId: state.session.id,
    ms,
    scramble: state.scramble,
  });
  solve.penalty = penalty;      // penalizacion heredada de la inspeccion

  await db.putSolve(solve);     // 1. IndexedDB primero
  state.solves.push(solve);
  el.time.textContent = stats.fmtSolve(solve);
  renderSolves();               // 2. UI ya actualizada
  renderStats();
  sync.schedule();              // 3. sincronizacion sin await, nunca bloquea

  void nextScramble();
}

/* ================= scrambles ================= */

async function nextScramble() {
  el.scrambleText.textContent = 'Generando scramble…';
  state.scramble = await scramble.next(state.session?.event || '333');
  el.scrambleText.textContent = state.scramble;
  el.scrambleSource.textContent = scramble.isRandomState() ? '' : 'generador de respaldo (no WCA)';
  el.scrambleSource.className = scramble.isRandomState() ? '' : 'badge-fallback';
}

el.newScramble.addEventListener('click', () => void nextScramble());

/* ================= lista de solves ================= */

function renderSolves() {
  if (!state.solves.length) {
    el.solveList.innerHTML =
      '<div class="empty">Todavia no hay tiempos.<br>Manten el espacio y suelta para empezar.</div>';
    return;
  }

  const rows = [...state.solves].reverse().map((s, i) => {
    const n = state.solves.length - i;
    const cls = s.penalty === 'DNF' ? 'dnf' : s.penalty === '+2' ? 'plus2' : '';
    return `
      <div class="solve-row" data-id="${s.id}">
        <span class="solve-index">${n}</span>
        <span class="solve-time ${cls}">${stats.fmtSolve(s)}</span>
        <span class="solve-actions">
          <button data-act="plus2" title="+2">+2</button>
          <button data-act="dnf" title="DNF">DNF</button>
          <button data-act="del" title="Borrar">×</button>
        </span>
      </div>`;
  });

  el.solveList.innerHTML = rows.join('');
}

el.solveList.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const row = e.target.closest('.solve-row');
  if (!row) return;
  const id = row.dataset.id;

  if (!btn) {
    const s = state.solves.find((x) => x.id === id);
    if (s) alert(`Scramble:\n\n${s.scramble}`);
    return;
  }

  const act = btn.dataset.act;
  if (act === 'del') {
    await db.softDeleteSolve(id);
    state.solves = state.solves.filter((x) => x.id !== id);
  } else {
    const s = state.solves.find((x) => x.id === id);
    const target = act === 'plus2' ? '+2' : 'DNF';
    const updated = await db.setPenalty(id, s.penalty === target ? 'none' : target);
    Object.assign(s, updated);
  }

  renderSolves();
  renderStats();
  sync.schedule();
});

/* Atajos sobre el ultimo solve, solo con el cronometro parado. */
window.addEventListener('keydown', async (e) => {
  if (timer.state !== 'idle') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (!state.solves.length) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  const last = state.solves[state.solves.length - 1];
  let touched = false;

  if (e.key === '2') {
    Object.assign(last, await db.setPenalty(last.id, last.penalty === '+2' ? 'none' : '+2'));
    touched = true;
  } else if (e.key.toLowerCase() === 'd') {
    Object.assign(last, await db.setPenalty(last.id, last.penalty === 'DNF' ? 'none' : 'DNF'));
    touched = true;
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    await db.softDeleteSolve(last.id);
    state.solves.pop();
    touched = true;
  }

  if (touched) { renderSolves(); renderStats(); sync.schedule(); }
});

/* ================= estadisticas ================= */

function renderStats() {
  const s = stats.summary(state.solves);
  const cells = [
    ['solves', s.count],
    ['mejor', stats.fmt(s.best)],
    ['mo3', stats.fmt(s.mo3)],
    ['ao5', stats.fmt(s.ao5)],
    ['ao12', stats.fmt(s.ao12)],
    ['mejor ao5', stats.fmt(s.bestAo5)],
    ['media', stats.fmt(s.mean)],
  ];
  el.statsBox.innerHTML = cells.map(([label, value]) => `
    <div class="stat">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>`).join('');
}

/* ================= sesiones ================= */

async function renderSessions() {
  const sessions = await db.listSessions();
  el.sessionSelect.innerHTML = sessions
    .map((s) => `<option value="${s.id}"${s.id === state.session.id ? ' selected' : ''}>${s.name}</option>`)
    .join('');
}

el.sessionSelect.addEventListener('change', async (e) => {
  timer.cancel();
  const sessions = await db.listSessions();
  state.session = sessions.find((s) => s.id === e.target.value);
  await db.setMeta('activeSessionId', state.session.id);
  state.solves = await db.listSolves(state.session.id);
  el.time.textContent = '0.00';
  renderSolves();
  renderStats();
});

el.newSession.addEventListener('click', async () => {
  const count = (await db.listSessions()).length;
  const name = prompt('Nombre de la sesion:', `Sesion ${count + 1}`);
  if (!name) return;
  const s = db.newSession(name);
  await db.putSession(s);
  state.session = s;
  await db.setMeta('activeSessionId', s.id);
  state.solves = [];
  await renderSessions();
  renderSolves();
  renderStats();
  sync.schedule();
});

/* ================= sincronizacion (indicador) ================= */

sync.onChange((st) => {
  let cls = '', label = '';
  if (st.status === 'syncing') { cls = 'pending'; label = 'sincronizando…'; }
  else if (st.status === 'error') { cls = 'error'; label = st.error || 'error'; }
  else if (st.pending > 0) { cls = 'pending'; label = `${st.pending} pendiente${st.pending > 1 ? 's' : ''}`; }
  else if (st.status === 'ok') { cls = 'ok'; label = 'al dia'; }
  else { label = 'solo local'; }

  el.syncDot.className = `sync-dot ${cls}`;
  el.syncLabel.textContent = label;
  el.syncLabel.title = st.error || '';
});

el.syncNow.addEventListener('click', () => void sync.flush());

/* ================= ajustes ================= */

function openModal(open) {
  el.modal.hidden = !open;
  timer.setEnabled(!open);
  if (open) void refreshInfo();
}

$('open-settings').addEventListener('click', () => openModal(true));
$('settings-close').addEventListener('click', () => openModal(false));
el.modal.addEventListener('click', (e) => { if (e.target === el.modal) openModal(false); });

async function refreshInfo() {
  $('info-count').textContent = state.solves.length;

  const p = await db.requestPersistence();
  const persistEl = $('info-persist');
  if (!p.supported) {
    persistEl.textContent = 'no soportado';
    persistEl.title = '';
  } else if (p.granted) {
    persistEl.textContent = 'concedido';
    persistEl.title = 'El navegador no desalojara estos datos bajo presion de disco.';
  } else {
    persistEl.textContent = 'NO concedido';
    persistEl.title = 'Normal en desarrollo. Chrome suele concederlo cuando la app '
      + 'esta instalada como PWA desde su dominio real. Exporta mientras tanto.';
  }

  const est = await db.estimate();
  $('info-usage').textContent = est ? `${(est.usage / 1024).toFixed(0)} KB` : '—';

  $('info-scramble').textContent = scramble.isRandomState() ? 'estado aleatorio (WCA)' : 'respaldo (no WCA)';

  // Desglosado: la sesion tambien es un registro que viaja al servidor,
  // asi que el total no coincide con el numero de solves.
  const pend = await db.pending();
  const nSolves = pend.solves.length;
  const nSessions = pend.sessions.length;
  const total = nSolves + nSessions;
  $('info-pending').textContent = total === 0
    ? '0'
    : `${total}  ·  ${nSolves} solve${nSolves === 1 ? '' : 's'} + ${nSessions} sesi${nSessions === 1 ? 'on' : 'ones'}`;

  $('opt-inspection').checked = timer.inspectionEnabled;
  $('opt-sound').checked = sound.isEnabled();

  const cfg = await sync.getConfig();
  $('sync-endpoint').value = cfg.endpoint;
  $('sync-token').value = cfg.token;
}

$('settings-save').addEventListener('click', async () => {
  await sync.setConfig({
    endpoint: $('sync-endpoint').value.trim(),
    token: $('sync-token').value.trim(),
  });
  openModal(false);
});

/* ---------- preferencias ---------- */

$('opt-inspection').addEventListener('change', async (e) => {
  timer.setInspection(e.target.checked);
  await db.setMeta('inspection', e.target.checked);
  timer.onState('idle');   // refresca el texto de ayuda
});

$('opt-sound').addEventListener('change', async (e) => {
  sound.setEnabled(e.target.checked);
  await db.setMeta('sound', e.target.checked);
  if (e.target.checked) { sound.unlock(); sound.cue8(); }  // confirmacion audible
});

async function loadPrefs() {
  const inspection = await db.getMeta('inspection', false);
  const snd = await db.getMeta('sound', true);
  timer.setInspection(inspection);
  sound.setEnabled(snd);
}

/* ---------- export / import ---------- */

$('export-btn').addEventListener('click', async () => {
  const data = await db.exportAll();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trimtimer-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('import-btn').addEventListener('click', () => $('import-file').click());

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const result = await db.importAll(data);
    alert(`Importado:\n${result.solves || 0} solves\n${result.sessions || 0} sesiones\n${result.skipped || 0} ya estaban al dia`);
    state.solves = await db.listSolves(state.session.id);
    await renderSessions();
    renderSolves();
    renderStats();
    sync.schedule();
  } catch (err) {
    alert(`No se pudo importar: ${err.message}`);
  } finally {
    e.target.value = '';
  }
});

/* ================= arranque ================= */

async function init() {
  await db.open();
  state.session = await db.ensureSession();
  state.solves = await db.listSolves(state.session.id);

  await loadPrefs();
  timer.onState('idle');   // deja el texto de ayuda acorde a las preferencias

  await renderSessions();
  renderSolves();
  renderStats();

  // Que el navegador no nos desaloje los tiempos bajo presion de disco.
  void db.requestPersistence();

  sync.installTriggers();

  // El prefetch arranca ya; el primer scramble siempre tarda porque el
  // solver tiene que montar sus tablas de busqueda.
  scramble.warmUp(state.session.event);
  void nextScramble();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

void init();
