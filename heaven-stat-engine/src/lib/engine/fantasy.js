/**
 * fantasy.js
 * BR Fantasy Player Pricing Engine
 *
 * Computes career-based fantasy credit costs for players using a weighted blend
 * of career KPM (Points Per Match / Kills Per Match baseline) and decayed Global Form.
 */

// ─── Tunable Constants ────────────────────────────────────────────────────────
export const KPM_WEIGHT = 0.6;
export const FORM_WEIGHT = 0.4;
export const MIN_PRICE = 10;
export const MAX_PRICE = 40;
export const MIN_MATCHES_THRESHOLD = 3;

// ─── Min-Max Normalization Helper ─────────────────────────────────────────────
function normalize(val, minVal, maxVal) {
  if (minVal == null || maxVal == null || isNaN(val)) return 50;
  if (maxVal === minVal) return 50;
  const clamped = Math.max(minVal, Math.min(maxVal, val));
  return Math.round(((clamped - minVal) / (maxVal - minVal)) * 10000) / 100;
}

/**
 * Computes fantasy credit prices for a list of players.
 *
 * @param {Array<Object>} players - Array of player records with career KPM and Global Form:
 *   [{ playerId, avgKillsPerMatch, decayedForm, matchesUsed, confidence }, ...]
 * @returns {Array<Object>} Array of player pricing records:
 *   [{ playerId, cost, blendedScore, confidence }, ...]
 */
export function computePlayerFantasyCost(players = []) {
  if (!Array.isArray(players) || players.length === 0) return [];

  // Identify eligible players with sufficient sample size for pool bounds
  const eligiblePlayers = players.filter((p) => {
    const matches = p.matchesUsed ?? p.careerMatches ?? 0;
    const confidence = p.confidence;
    return matches >= MIN_MATCHES_THRESHOLD && confidence !== 'unranked';
  });

  const kpmValues = eligiblePlayers
    .map((p) => Number(p.avgKillsPerMatch ?? p.killsPerMatch ?? p.kpm ?? 0))
    .filter((v) => !isNaN(v));

  const formValues = eligiblePlayers
    .map((p) => Number(p.decayedForm ?? p.rawForm ?? p.form ?? 0))
    .filter((v) => !isNaN(v));

  const minKPM = kpmValues.length > 0 ? Math.min(...kpmValues) : 0;
  const maxKPM = kpmValues.length > 0 ? Math.max(...kpmValues) : 1;

  const minForm = formValues.length > 0 ? Math.min(...formValues) : 0;
  const maxForm = formValues.length > 0 ? Math.max(...formValues) : 1;

  return players.map((p) => {
    const playerId = p.playerId || p.id;
    const matchesUsed = p.matchesUsed ?? p.careerMatches ?? 0;
    const confidence = p.confidence || (matchesUsed >= MIN_MATCHES_THRESHOLD ? 'provisional' : 'unranked');

    // Minimum sample size guard: fewer than 3 matches -> unpriced (null)
    if (matchesUsed < MIN_MATCHES_THRESHOLD || confidence === 'unranked') {
      return {
        playerId,
        cost: null,
        blendedScore: null,
        confidence,
      };
    }

    const kpm = Number(p.avgKillsPerMatch ?? p.killsPerMatch ?? p.kpm ?? 0);
    const form = Number(p.decayedForm ?? p.rawForm ?? p.form ?? 0);

    const N_KPM = normalize(kpm, minKPM, maxKPM);
    const N_Form = normalize(form, minForm, maxForm);

    const blendedScore = Math.round(((N_KPM * KPM_WEIGHT) + (N_Form * FORM_WEIGHT)) * 100) / 100;
    const cost = Math.round(MIN_PRICE + (blendedScore / 100) * (MAX_PRICE - MIN_PRICE));

    return {
      playerId,
      cost,
      blendedScore,
      confidence,
    };
  });
}
