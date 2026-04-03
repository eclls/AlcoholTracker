/**
 * Estimation pédagogique du taux d'alcoolémie (g/L) — NE remplace pas une mesure sanguine ni un alcootest homologué.
 * Modèle: variante Widmark + élimination d'ordre zéro (β), ajustements documentés (type de boisson, repas)
 * Réf. clé: Mitchell et al., Alcohol Clin Exp Res. 2014 (PMC4112772) — pic et cinétique selon bière/vin/spiritueux à jeun.
 */

const ETHANOL_DENSITY = 0.789; // g/ml

export const BODY_R = { male: 0.68, female: 0.55, other: 0.62 };

export const DEFAULT_BETA_GL_H = 0.14;

/**
 * Multiplicateurs d'exposition relative (ordre de grandeur Mitchell 2014) — bière < vin < spiritueux.
 */
export const BEVERAGE_FACTOR = {
  beer: 0.88,
  wine: 0.96,
  spirits: 1.0,
  cocktail: 0.98,
  other: 0.95
};

export const FOOD_FACTOR = { yes: 0.92, no: 1.0 };

export const ACTIVITY_FACTOR = { yes: 0.97, no: 1.0 };

export function ethanolGrams(volumeMl, abvPercent) {
  return volumeMl * (abvPercent / 100) * ETHANOL_DENSITY;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

/**
 * Simulation pas 2 min: entrées par boisson (montée sur absorptionPlateauH), élimination β (g/L/h)
 */
function simulateBAC(sorted, tMs, beta, r, w) {
  if (sorted.length === 0) return { bacGL: 0, peakGL: 0 };
  const tStart = sorted[0].t;
  const dtMin = 2;
  let bac = 0;
  let peak = 0;
  for (let t = tStart; t <= tMs; t += dtMin * 60 * 1000) {
    let inflowGL = 0;
    const dtH = dtMin / 60;
    for (const d of sorted) {
      const food = d.foodBefore ? FOOD_FACTOR.yes : FOOD_FACTOR.no;
      const act = d.activityBefore ? ACTIVITY_FACTOR.yes : ACTIVITY_FACTOR.no;
      const gAdj = d.g * food * act;
      const durationMin = Math.max(5, Number(d.durationMin) || 30);
      const drinkSpanH = durationMin / 60;
      const bev = d.beverage || 'other';
      let delayMin = bev === 'beer' ? 50 : bev === 'wine' ? 42 : bev === 'spirits' ? 32 : 40;
      if (d.foodBefore) delayMin += 18;
      const absorptionPlateauH = Math.max(0.25, drinkSpanH + delayMin / 60);
      const hoursAfter = (t - d.t) / (1000 * 3600);
      if (hoursAfter <= 0) continue;
      let ratePerH = 0;
      if (hoursAfter < absorptionPlateauH) {
        ratePerH = gAdj / absorptionPlateauH;
      }
      inflowGL += (ratePerH * dtH) / (r * w);
    }
    bac = Math.max(0, bac + inflowGL - beta * dtH);
    if (bac > peak) peak = bac;
  }
  return { bacGL: bac, peakGL: peak };
}

function hintPeakMinutes(lastDrink) {
  const bev = lastDrink.beverage || 'other';
  let m = bev === 'beer' ? 62 : bev === 'wine' ? 54 : bev === 'spirits' ? 36 : 45;
  if (lastDrink.foodBefore) m += 12;
  return m;
}

/**
 * @param {object} profile - { sex, weightKg, betaGlH? }
 * @param {Array} drinks - { at, volumeMl, abv, beverage, foodBefore, activityBefore, durationMin }
 * @param {Date} [now]
 */
export function estimateBAC(profile, drinks, now = new Date()) {
  const w = Math.max(40, Number(profile.weightKg) || 70);
  const sex = profile.sex === 'female' ? 'female' : profile.sex === 'male' ? 'male' : 'other';
  const r = BODY_R[sex];
  const beta = Math.max(0.08, Math.min(0.22, Number(profile.betaGlH) || DEFAULT_BETA_GL_H));

  const sorted = [...drinks]
    .map((d) => ({
      ...d,
      t: new Date(d.at).getTime(),
      g: ethanolGrams(Number(d.volumeMl) || 0, Number(d.abv) || 0) * (BEVERAGE_FACTOR[d.beverage] || BEVERAGE_FACTOR.other)
    }))
    .filter((d) => d.g > 0 && !Number.isNaN(d.t))
    .sort((a, b) => a.t - b.t);

  if (sorted.length === 0) {
    return {
      bacGL: 0,
      peakEstimateGL: 0,
      hoursSinceFirst: 0,
      minutesToPeakHint: null,
      disclaimer:
        'Aucune consommation enregistrée. Les estimations sont indicatives (voir Sources).'
    };
  }

  const tMs = now.getTime();
  const t0 = sorted[0].t;
  const hoursSinceFirst = (tMs - t0) / (1000 * 3600);

  const { bacGL, peakGL } = simulateBAC(sorted, tMs, beta, r, w);
  const last = sorted[sorted.length - 1];

  return {
    bacGL: round2(Math.max(0, bacGL)),
    peakEstimateGL: round2(Math.max(0, peakGL)),
    hoursSinceFirst: round2(hoursSinceFirst),
    minutesToPeakHint: hintPeakMinutes(last),
    disclaimer:
      'Estimation théorique (Widmark + β, ajustements type de boisson/repas). Ne constitue pas une preuve légale ni médicale.'
  };
}

export function legalLimitGL() {
  return 0.5;
}
