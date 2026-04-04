import { estimateBAC, ethanolGrams, legalLimitGL } from './bac.js';

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
    remindersPerDay: 3,
    windowStart: '08:00',
    windowEnd: '22:00',
    session: false
  },
  drinks: [],
  blockList: '',
  lastNotifiedLegal: 0,
  lastNotifiedDrunk: 0,
  lastWaterSession: 0,
  /** @type {Record<string, string>} clé `daily-0`… → date ISO jour `YYYY-MM-DD` */
  lastWaterDailyFired: {}
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const base = defaultState();
    const merged = { ...base, ...parsed, drinks: parsed.drinks || [] };
    merged.water = { ...base.water, ...(parsed.water || {}) };
    if (parsed.water?.time && !parsed.water?.windowStart) {
      merged.water.windowStart = '08:00';
      merged.water.windowEnd = '22:00';
      merged.water.remindersPerDay = 1;
    }
    merged.lastWaterDailyFired = { ...(base.lastWaterDailyFired || {}), ...(parsed.lastWaterDailyFired || {}) };
    return merged;
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
  document.querySelectorAll('nav.dock button[data-tab]').forEach((b) => {
    b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
  });
  document.querySelectorAll('main section.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `panel-${id}`);
  });
  if (id === 'dash') refreshDash();
}

document.querySelectorAll('nav.dock button[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => setTab(btn.dataset.tab));
});

document.querySelectorAll('[data-go-tab]').forEach((node) => {
  node.addEventListener('click', () => setTab(node.getAttribute('data-go-tab')));
});

function syncDurationLabel() {
  const d = el('duration');
  const lab = el('duration-label');
  if (d && lab) lab.textContent = String(d.value);
}

const dur = el('duration');
if (dur) {
  dur.addEventListener('input', syncDurationLabel);
  syncDurationLabel();
}

function highlightBeverageCat() {
  const v = el('beverage').value;
  document.querySelectorAll('.beverage-cat').forEach((btn) => {
    btn.classList.toggle('is-selected', btn.getAttribute('data-beverage') === v);
  });
}

document.querySelectorAll('.beverage-cat').forEach((btn) => {
  btn.addEventListener('click', () => {
    el('beverage').value = btn.getAttribute('data-beverage');
    highlightBeverageCat();
  });
});

el('beverage').addEventListener('change', highlightBeverageCat);

const btnWater = el('btn-dash-water');
if (btnWater) {
  btnWater.addEventListener('click', () => showToast('Pensez à boire un grand verre d’eau.'));
}
const btnWaterDismiss = el('btn-dash-water-dismiss');
if (btnWaterDismiss) {
  btnWaterDismiss.addEventListener('click', () => showToast('Rappel hydratation reporté.'));
}

function profileToForm() {
  el('sex').value = state.profile.sex;
  el('weight').value = state.profile.weightKg;
  el('height').value = state.profile.heightCm;
  el('beta').value = state.profile.betaGlH;
  el('threshold-legal').value = state.thresholds.legal;
  el('threshold-drunk').value = state.thresholds.drunk;
  el('water-daily').checked = !!state.water.daily;
  el('water-reminders-count').value = state.water.remindersPerDay ?? 3;
  el('water-window-start').value = state.water.windowStart || '08:00';
  el('water-window-end').value = state.water.windowEnd || '22:00';
  el('water-session').checked = !!state.water.session;
  el('block-list').value = state.blockList || '';
  updateWaterScheduleSummary();
}

function formToProfile() {
  state.profile.sex = el('sex').value;
  state.profile.weightKg = Number(el('weight').value) || 75;
  state.profile.heightCm = Number(el('height').value) || 175;
  state.profile.betaGlH = Number(el('beta').value) || 0.14;
  state.thresholds.legal = Number(el('threshold-legal').value) || legalLimitGL();
  state.thresholds.drunk = Number(el('threshold-drunk').value) || 0.8;
  state.water.daily = el('water-daily').checked;
  state.water.remindersPerDay = Math.max(1, Math.min(8, Number(el('water-reminders-count').value) || 3));
  state.water.windowStart = el('water-window-start').value;
  state.water.windowEnd = el('water-window-end').value;
  state.water.session = el('water-session').checked;
  state.blockList = el('block-list').value;
  saveState(state);
}

function parseTimeToMinutes(s) {
  const [h, m] = (s || '0:0').split(':').map(Number);
  return h * 60 + m;
}

function minutesToLabel(mins) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mi = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function computeWaterReminderSlotsMinutes(n, windowStart, windowEnd) {
  const start = parseTimeToMinutes(windowStart);
  const end = parseTimeToMinutes(windowEnd);
  let w = end - start;
  if (w <= 0) w += 1440;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const t = start + ((i + 1) * w) / (n + 1);
    slots.push(Math.floor(t) % 1440);
  }
  return slots;
}

function updateWaterScheduleSummary() {
  const box = el('water-schedule-summary');
  if (!box) return;
  const n = Math.max(1, Math.min(8, Number(el('water-reminders-count')?.value) || 3));
  const ws = el('water-window-start')?.value || '08:00';
  const we = el('water-window-end')?.value || '22:00';
  const slots = computeWaterReminderSlotsMinutes(n, ws, we);
  const labels = slots.map(minutesToLabel).join(', ');
  box.textContent = `${n} rappel${n > 1 ? 's' : ''} par jour entre ${ws} et ${we} — créneaux indicatifs : ${labels}. Les notifications ne sont envoyées que si l’autorisation est accordée (voir ci-dessus).`;
}

function refreshNotifStatus() {
  const msgDash = el('notif-status');
  const detail = el('notif-profile-detail');
  const badgeEl = el('notif-permission-badge');

  let msg = '';
  let badge = '…';

  if (typeof Notification === 'undefined') {
    msg = 'Les notifications ne sont pas disponibles dans ce navigateur.';
    badge = 'Non supporté';
  } else if (Notification.permission === 'granted') {
    msg =
      'Notifications autorisées : alerte seuil légal (g/L), rappels eau sur la plage horaire définie, rappel session (45 min) si consommation en cours.';
    badge = 'Autorisées';
  } else if (Notification.permission === 'denied') {
    msg =
      'Notifications refusées. Sur iPhone : Réglages → Safari → Notifications du site, ou Réglages de l’app si installée sur l’écran d’accueil.';
    badge = 'Refusées';
  } else {
    msg = 'Notifications pas encore demandées. Touchez « Autoriser » (en-tête ou ci-dessous).';
    badge = 'En attente';
  }

  if (msgDash) msgDash.textContent = msg;
  if (detail) detail.textContent = msg;
  if (badgeEl) {
    badgeEl.textContent = `État : ${badge}`;
    badgeEl.className =
      'rounded-full border px-3 py-1 text-xs font-semibold ' +
      (typeof Notification !== 'undefined' && Notification.permission === 'granted'
        ? 'border-secondary/40 text-secondary'
        : typeof Notification !== 'undefined' && Notification.permission === 'denied'
          ? 'border-error/40 text-error'
          : 'border-outline-variant/40 text-on-surface-variant');
  }
}

async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    const msg = 'Notifications non supportées sur ce navigateur.';
    if (el('notif-status')) el('notif-status').textContent = msg;
    if (el('notif-profile-detail')) el('notif-profile-detail').textContent = msg;
    refreshNotifStatus();
    return;
  }
  await Notification.requestPermission();
  refreshNotifStatus();
}

['sex', 'weight', 'height', 'beta', 'threshold-legal', 'threshold-drunk', 'water-daily', 'water-reminders-count', 'water-window-start', 'water-window-end', 'water-session'].forEach(
  (id) => {
    el(id).addEventListener('change', () => {
      formToProfile();
      updateWaterScheduleSummary();
      refreshDash();
    });
  }
);

['water-reminders-count', 'water-window-start', 'water-window-end'].forEach((id) => {
  el(id).addEventListener('input', () => {
    updateWaterScheduleSummary();
  });
});

el('block-list').addEventListener('change', formToProfile);
el('btn-save-blocks').addEventListener('click', () => {
  formToProfile();
  showToast('Liste enregistrée.');
});

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function drinksToday() {
  const t = todayIso();
  return state.drinks.filter((d) => d.at.slice(0, 10) === t);
}

function totalAlcoholKcal(drinks) {
  let g = 0;
  for (const d of drinks) {
    g += ethanolGrams(Number(d.volumeMl) || 0, Number(d.abv) || 0);
  }
  return Math.round(g * 7);
}

function renderDashTimeline() {
  const box = el('dash-timeline');
  if (!box) return;
  const list = drinksToday().sort((a, b) => new Date(a.at) - new Date(b.at));
  const icon = (b) =>
    ({ beer: 'sports_bar', wine: 'wine_bar', spirits: 'liquor', cocktail: 'local_bar', other: 'liquor' }[b] || 'local_bar');

  const cards = list
    .map((d) => {
      const time = new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const title = escapeHtml(d.label || d.beverage);
      return `<div class="glass-card flex w-40 shrink-0 flex-col rounded-lg border border-outline-variant/10 p-4">
        <span class="mb-2 block text-[10px] font-bold uppercase text-on-surface-variant">${time}</span>
        <div class="mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container-high">
          <span class="material-symbols-outlined text-primary-fixed-dim">${icon(d.beverage)}</span>
        </div>
        <h4 class="text-sm font-bold text-on-surface">${title}</h4>
        <p class="text-[11px] text-on-surface-variant">${d.volumeMl} ml · ${d.abv}%</p>
      </div>`;
    })
    .join('');

  const addCard = `<button type="button" class="flex w-40 shrink-0 flex-col items-center justify-center rounded-lg border-2 border-dashed border-outline-variant/25 p-4 text-on-surface-variant transition-colors hover:border-primary/40 hover:text-primary" data-go-tab="log">
    <span class="material-symbols-outlined">add</span>
    <span class="mt-2 text-[10px] font-bold uppercase">Ajouter</span>
  </button>`;

  box.innerHTML = (cards || '') + addCard;
  box.querySelectorAll('[data-go-tab]').forEach((b) => {
    b.addEventListener('click', () => setTab(b.getAttribute('data-go-tab')));
  });
}

function setDashSafeUI(bac, legal, drunk) {
  const badge = el('dash-safe-badge');
  const icon = el('dash-safe-icon');
  const label = el('dash-safe-label');
  if (!badge || !icon || !label) return;

  badge.className =
    'safe-glow inline-flex items-center gap-2 rounded-full border px-6 py-3 transition-colors duration-200';
  icon.style.fontVariationSettings = "'FILL' 1";

  if (bac >= drunk) {
    badge.classList.add('border-error/30', 'bg-error-container/25');
    icon.className = 'material-symbols-outlined text-[22px] text-error';
    icon.textContent = 'gpp_bad';
    label.className = 'font-label text-xs font-bold uppercase tracking-widest text-error';
    label.textContent = 'Mode sécurité recommandé';
  } else if (bac >= legal) {
    badge.classList.add('border-tertiary/25', 'bg-tertiary-container/25');
    icon.className = 'material-symbols-outlined text-[22px] text-tertiary';
    icon.textContent = 'warning';
    label.className = 'font-label text-xs font-bold uppercase tracking-widest text-tertiary';
    label.textContent = 'Au-dessus du seuil';
  } else {
    badge.classList.add('border-secondary/15', 'bg-secondary-container/20');
    icon.className = 'material-symbols-outlined text-[22px] text-secondary';
    icon.textContent = 'check_circle';
    label.className = 'font-label text-xs font-bold uppercase tracking-widest text-secondary';
    label.textContent = 'Sous le seuil d’alerte';
  }
}

function refreshDash() {
  const res = estimateBAC(state.profile, state.drinks);
  const bac = res.bacGL;
  const val = el('bac-value');
  val.textContent = bac.toFixed(2).replace('.', ',');
  val.classList.remove('warn', 'danger');
  if (bac >= state.thresholds.legal) val.classList.add('warn');
  if (bac >= state.thresholds.drunk) val.classList.add('danger');

  const ring = el('bac-ring');
  if (ring) {
    const r = parseFloat(ring.getAttribute('r')) || 132;
    const len = 2 * Math.PI * r;
    const pct = Math.min(1, Math.max(0, bac / 1.2));
    const offset = len * (1 - pct);
    ring.style.strokeDasharray = String(len);
    ring.style.strokeDashoffset = String(offset);
    ring.setAttribute('stroke-dasharray', String(len));
    ring.setAttribute('stroke-dashoffset', String(offset));
  }

  setDashSafeUI(bac, state.thresholds.legal, state.thresholds.drunk);

  const beta = Math.max(0.08, Math.min(0.22, Number(state.profile.betaGlH) || 0.14));
  const sober = el('dash-sober-text');
  if (sober) {
    if (bac <= 0) {
      sober.textContent = 'Aucune estimation active. Enregistrez une consommation pour lancer le suivi.';
    } else {
      const h = bac / beta;
      const eta = new Date(Date.now() + h * 3600000);
      sober.textContent = `Élimination théorique ~${h.toFixed(1).replace('.', ',')} h — vers ${eta.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} (ordre de grandeur).`;
    }
  }

  const kcalEl = el('dash-kcal');
  if (kcalEl) kcalEl.textContent = String(totalAlcoholKcal(drinksToday()));

  const hyd = el('dash-hydration-pct');
  if (hyd) {
    const n = drinksToday().length;
    hyd.textContent = n ? String(Math.min(95, 45 + n * 8)) : '—';
  }

  el('meta-peak').textContent = `Pic ≈ ${res.peakEstimateGL.toFixed(2).replace('.', ',')} g/L`;
  el('meta-since').innerHTML =
    res.hoursSinceFirst > 0
      ? `Δt ${res.hoursSinceFirst.toFixed(1).replace('.', ',')} h`
      : '—';
  el('bac-disclaimer').textContent = res.disclaimer;

  const impactBac = el('impact-bac');
  if (impactBac) impactBac.textContent = `${bac.toFixed(2).replace('.', ',')} g/L`;
  const impactBar = el('impact-bar');
  if (impactBar) impactBar.style.width = `${Math.min(100, (bac / 1.2) * 100)}%`;

  renderDashTimeline();

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
    new Notification('Aura', {
      body: `Estimation ≥ ${legal} g/L — évitez de conduire.`,
      tag: 'legal'
    });
  }
}

function waterDailyCheck() {
  if (!state.water.daily || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const n = Math.max(1, Math.min(8, Number(state.water.remindersPerDay) || 3));
  const slots = computeWaterReminderSlotsMinutes(n, state.water.windowStart || '08:00', state.water.windowEnd || '22:00');
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const today = todayIso();
  if (!state.lastWaterDailyFired) state.lastWaterDailyFired = {};

  for (let i = 0; i < slots.length; i++) {
    if (Math.abs(nowMin - slots[i]) > 1) continue;
    const slotKey = `daily-${i}`;
    if (state.lastWaterDailyFired[slotKey] === today) continue;
    state.lastWaterDailyFired[slotKey] = today;
    saveState(state);
    new Notification('Aura', {
      body: `Hydratation — rappel ${i + 1}/${n} (vers ${minutesToLabel(slots[i])}).`,
      tag: `water-daily-${i}`
    });
    break;
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

el('btn-notif').addEventListener('click', () => requestNotificationPermission());
const btnNotifProf = el('btn-notif-profile');
if (btnNotifProf) btnNotifProf.addEventListener('click', () => requestNotificationPermission());

function tick() {
  waterDailyCheck();
  refreshDash();
}

setInterval(tick, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    refreshNotifStatus();
    refreshDash();
  }
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
    box.innerHTML = `<p class="meta-tiny">Vide · ${selectedDay}</p>`;
    return;
  }
  box.innerHTML = list
    .map((d) => {
      const t = new Date(d.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const photo = d.photoData ? `<img class="thumb" src="${d.photoData}" alt="" />` : '';
      return `<div class="list-entry">
        <strong>${t}</strong> · ${d.label || d.beverage} · ${d.volumeMl} ml · ${d.abv}%<br/>
        <span class="meta-tiny">Repas ${d.foodBefore ? 'oui' : 'non'} · sport ${d.activityBefore ? 'oui' : 'non'}</span>
        ${d.notes ? `<br/><span class="meta-tiny">${escapeHtml(d.notes)}</span>` : ''}
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

/** Service worker */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

profileToForm();
highlightBeverageCat();
refreshNotifStatus();
renderCalendar();
setTab('dash');
