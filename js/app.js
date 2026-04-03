import { estimateBAC, legalLimitGL } from './bac.js';

const STORAGE_KEY = 'alcool-tracker-v1';

const defaultState = () => ({
  profile: {
    sex: 'male',
    weightKg: 75,
    heightCm: 175,
    betaGlH: 0.14
  },
  thresholds: {
    legal: 0.5,
    drunk: 0.8
  },
  water: {
    daily: false,
    time: '12:00',
    session: false
  },
  drinks: [],
  blockList: '',
  lastNotifiedLegal: 0,
  lastNotifiedDrunk: 0,
  lastWaterSession: 0,
  lastWaterDaily: 0
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed, drinks: parsed.drinks || [] };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

const el = (id) => document.getElementById(id);

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 3200);
}

function setTab(id) {
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
  });
  document.querySelectorAll('main section.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${id}`);
  });
}

document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

function profileToForm() {
  el('sex').value = state.profile.sex;
  el('weight').value = state.profile.weightKg;
  el('height').value = state.profile.heightCm;
  el('beta').value = state.profile.betaGlH;
  el('threshold-legal').value = state.thresholds.legal;
  el('threshold-drunk').value = state.thresholds.drunk;
  el('water-daily').checked = !!state.water.daily;
  el('water-time').value = state.water.time || '12:00';
  el('water-session').checked = !!state.water.session;
  el('block-list').value = state.blockList || '';
}

function formToProfile() {
  state.profile.sex = el('sex').value;
  state.profile.weightKg = Number(el('weight').value) || 75;
  state.profile.heightCm = Number(el('height').value) || 175;
  state.profile.betaGlH = Number(el('beta').value) || 0.14;
  state.thresholds.legal = Number(el('threshold-legal').value) || legalLimitGL();
  state.thresholds.drunk = Number(el('threshold-drunk').value) || 0.8;
  state.water.daily = el('water-daily').checked;
  state.water.time = el('water-time').value;
  state.water.session = el('water-session').checked;
  state.blockList = el('block-list').value;
  saveState(state);
}

['sex', 'weight', 'height', 'beta', 'threshold-legal', 'threshold-drunk', 'water-daily', 'water-time', 'water-session'].forEach(
  (id) => {
    el(id).addEventListener('change', () => {
      formToProfile();
      refreshDash();
    });
  }
);

el('block-list').addEventListener('change', formToProfile);
el('btn-save-blocks').addEventListener('click', () => {
  formToProfile();
  showToast('Liste enregistrée.');
});

function refreshDash() {
  const res = estimateBAC(state.profile, state.drinks);
  const bac = res.bacGL;
  const val = el('bac-value');
  val.textContent = bac.toFixed(2).replace('.', ',');
  val.classList.remove('warn', 'danger');
  if (bac >= state.thresholds.legal) val.classList.add('warn');
  if (bac >= state.thresholds.drunk) val.classList.add('danger');

  el('meta-peak').textContent = `Pic (simulation) ≈ ${res.peakEstimateGL.toFixed(2).replace('.', ',')} g/L`;
  el('meta-since').innerHTML =
    res.hoursSinceFirst > 0
      ? `Depuis 1<sup>re</sup> gorgée ≈ ${res.hoursSinceFirst.toFixed(1).replace('.', ',')} h`
      : 'Session en cours ou vide';
  el('bac-disclaimer').textContent = res.disclaimer;
  el('show-legal').textContent = String(state.thresholds.legal).replace('.', ',');

  drunkModeCheck(bac);
  notifyCheck(bac);
  waterSessionCheck(bac);
}

function drunkModeCheck(bac) {
  const overlay = el('drunk-overlay');
  const thr = state.thresholds.drunk;
  if (bac < thr * 0.85) {
    sessionStorage.removeItem('drunk-dismiss');
  }
  if (bac >= thr && sessionStorage.getItem('drunk-dismiss') !== '1') {
    const blk = el('drunk-blocks');
    const txt = (state.blockList || '').trim();
    if (txt) {
      blk.textContent = `Rappel — prudence avec : ${txt}`;
      blk.style.display = 'block';
    } else {
      blk.textContent = '';
      blk.style.display = 'none';
    }
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }
}

function drunkClose() {
  sessionStorage.setItem('drunk-dismiss', '1');
  const overlay = el('drunk-overlay');
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
}

el('drunk-close').addEventListener('click', drunkClose);

/** Notifications: seuil légal + eau */
function notifyCheck(bac) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = Date.now();
  const legal = state.thresholds.legal;
  if (bac >= legal && now - state.lastNotifiedLegal > 5 * 60 * 1000) {
    state.lastNotifiedLegal = now;
    saveState(state);
    new Notification('Alcool Tracker', {
      body: `Estimation ≥ ${legal} g/L — évitez de conduire.`,
      tag: 'legal'
    });
  }
}

function waterDailyCheck() {
  if (!state.water.daily || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const [h, m] = (state.water.time || '12:00').split(':').map(Number);
  const now = new Date();
  if (now.getHours() === h && now.getMinutes() === m && Date.now() - (state.lastWaterDaily || 0) > 60000) {
    state.lastWaterDaily = Date.now();
    saveState(state);
    new Notification('Hydratation', { body: 'Pensez à boire de l’eau.', tag: 'water-daily' });
  }
}

function waterSessionCheck(bac) {
  if (!state.water.session || bac <= 0) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const now = Date.now();
  if (now - state.lastWaterSession > 45 * 60 * 1000) {
    state.lastWaterSession = now;
    saveState(state);
    new Notification('Hydratation', { body: 'Pendant la consommation : un verre d’eau.', tag: 'water-session' });
  }
}

el('btn-notif').addEventListener('click', async () => {
  if (!('Notification' in window)) {
    el('notif-status').textContent = 'Notifications non supportées sur ce navigateur.';
    return;
  }
  const p = await Notification.requestPermission();
  el('notif-status').textContent =
    p === 'granted'
      ? 'Notifications activées. Gardez l’app ouverte en session pour une meilleure fiabilité sur iOS.'
      : 'Refusé — rappels désactivés.';
});

function tick() {
  waterDailyCheck();
  refreshDash();
}

setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshDash();
});

/** Enregistrer une boisson */
function nowLocalInputValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

el('at-time').value = nowLocalInputValue();

el('btn-save-drink').addEventListener('click', async () => {
  formToProfile();
  const label = el('drink-label').value.trim();
  const volumeMl = Number(el('volume').value);
  const abv = Number(el('abv').value);
  const beverage = el('beverage').value;
  const at = el('at-time').value ? new Date(el('at-time').value).toISOString() : new Date().toISOString();
  const durationMin = Number(el('duration').value);
  const foodBefore = el('food').value === 'yes';
  const activityBefore = el('activity').value === 'yes';
  const notes = el('notes').value.trim();
  let photoData = null;
  const file = el('photo').files?.[0];
  if (file && file.size < 2 * 1024 * 1024) {
    photoData = await readFileAsDataUrl(file);
  }

  const id = crypto.randomUUID?.() || String(Date.now());
  state.drinks.push({
    id,
    label,
    volumeMl,
    abv,
    beverage,
    at,
    durationMin,
    foodBefore,
    activityBefore,
    notes,
    photoData
  });
  saveState(state);
  el('drink-label').value = '';
  el('notes').value = '';
  el('photo').value = '';
  showToast('Consommation enregistrée.');
  refreshDash();
  renderCalendar();
  setTab('dash');
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Calendrier */
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
let selectedDay = null;

function drinksByDay() {
  const map = {};
  for (const d of state.drinks) {
    const day = d.at.slice(0, 10);
    if (!map[day]) map[day] = [];
    map[day].push(d);
  }
  return map;
}

function renderCalendar() {
  const map = drinksByDay();
  const title = el('cal-title');
  const monthNames = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre'
  ];
  title.textContent = `${monthNames[calMonth]} ${calYear}`;

  const head = el('cal-head');
  head.innerHTML = '';
  const dows = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  dows.forEach((dd) => {
    const c = document.createElement('div');
    c.className = 'dow';
    c.textContent = dd;
    head.appendChild(c);
  });

  const grid = el('cal-grid');
  grid.innerHTML = '';
  const first = new Date(calYear, calMonth, 1);
  const start = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  if (selectedDay === null) {
    selectedDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }

  for (let i = 0; i < start; i++) {
    const e = document.createElement('div');
    e.className = 'day';
    e.style.visibility = 'hidden';
    grid.appendChild(e);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'day';
    if (map[iso]) cell.classList.add('has-data');
    if (
      today.getFullYear() === calYear &&
      today.getMonth() === calMonth &&
      today.getDate() === d
    ) {
      cell.classList.add('today');
    }
    cell.textContent = String(d);
    cell.addEventListener('click', () => {
      selectedDay = iso;
      renderDayDetail();
    });
    grid.appendChild(cell);
  }
  renderDayDetail();
}

function renderDayDetail() {
  const map = drinksByDay();
  const box = el('cal-day-detail');
  const list = map[selectedDay] || [];
  if (list.length === 0) {
    box.innerHTML = `<p class="disclaimer">Aucune entrée pour ${selectedDay}.</p>`;
    return;
  }
  box.innerHTML = list
    .map((d) => {
      const t = new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const photo = d.photoData ? `<img class="thumb" src="${d.photoData}" alt="" />` : '';
      return `<div class="list-entry">
        <strong>${t}</strong> — ${d.label || d.beverage} · ${d.volumeMl} ml · ${d.abv}% vol.<br/>
        <span class="disclaimer">Repas: ${d.foodBefore ? 'oui' : 'non'} · Activité: ${d.activityBefore ? 'oui' : 'non'}</span>
        ${d.notes ? `<br/>${escapeHtml(d.notes)}` : ''}
        ${photo}
      </div>`;
    })
    .join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

el('cal-prev').addEventListener('click', () => {
  calMonth--;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  }
  renderCalendar();
});

el('cal-next').addEventListener('click', () => {
  calMonth++;
  if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderCalendar();
});

el('btn-export').addEventListener('click', () => {
  formToProfile();
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `alcool-tracker-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('Export téléchargé.');
});

/** Service worker */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

profileToForm();
refreshDash();
renderCalendar();

setTab('dash');
