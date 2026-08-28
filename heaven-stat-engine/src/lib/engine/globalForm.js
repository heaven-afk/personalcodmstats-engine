const WINDOW_SIZE = 8;
const GRACE_PERIOD_DAYS = 7;
const DECAY_RATE = 0.04;

function round2(n) {
  if (n == null || isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Computes rolling Form from a chronologically-sorted array of match points.
 * matchPoints: [{ date: Date, value: number }, ...]
 */
export function computeRollingForm(matchPoints) {
  if (!matchPoints || matchPoints.length === 0) {
    return {
      rawForm: null,
      decayedForm: null,
      confidence: 'unranked',
      trend: 'new',
      matchesUsed: 0,
      lastMatchDate: null,
      daysInactive: 0,
    };
  }

  const sorted = [...matchPoints].sort((a, b) => (a.date ? a.date.getTime() : 0) - (b.date ? b.date.getTime() : 0));
  const window = sorted.slice(-WINDOW_SIZE);
  const matchesUsed = window.length;

  const weights = window.map((_, i) => i + 1); // e.g. [1,2,3,4,5,6,7,8]
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rawForm = window.reduce((sum, pt, i) => sum + (pt.value || 0) * weights[i], 0) / weightSum;

  const confidence = matchesUsed >= WINDOW_SIZE ? 'full' : matchesUsed >= 3 ? 'provisional' : 'unranked';

  const lastMatchDate = sorted[sorted.length - 1].date;
  const lastTime = lastMatchDate ? lastMatchDate.getTime() : Date.now();
  const daysInactive = Math.max(0, (Date.now() - lastTime) / (1000 * 60 * 60 * 24));
  const decayMultiplier = daysInactive <= GRACE_PERIOD_DAYS
    ? 1
    : Math.max(0, 1 - DECAY_RATE * (daysInactive - GRACE_PERIOD_DAYS));
  const decayedForm = rawForm * decayMultiplier;

  const priorWindow = sorted.slice(-WINDOW_SIZE * 2, -WINDOW_SIZE);
  let trend = 'new';
  if (priorWindow.length >= 3) {
    const priorWeights = priorWindow.map((_, i) => i + 1);
    const priorWeightSum = priorWeights.reduce((a, b) => a + b, 0);
    const priorForm = priorWindow.reduce((sum, pt, i) => sum + (pt.value || 0) * priorWeights[i], 0) / priorWeightSum;
    const pctChange = priorForm > 0 ? (rawForm - priorForm) / priorForm : 0;
    trend = pctChange > 0.05 ? 'up' : pctChange < -0.05 ? 'down' : 'flat';
  }

  return {
    rawForm: round2(rawForm),
    decayedForm: round2(decayedForm),
    confidence,
    trend,
    matchesUsed,
    lastMatchDate,
    daysInactive: Math.round(daysInactive),
  };
}

/**
 * Computes single match PPM for team results in a lobby
 */
function computeSingleMatchPPM(matchResults, scoring = {}) {
  const placementPoints = scoring.placementPoints || [
    { position: 1, points: 25 }, { position: 2, points: 20 },
    { position: 3, points: 15 }, { position: 4, points: 10 },
    { position: 5, points: 5 },
  ];
  const killPointValue = scoring.killPointValue != null ? Number(scoring.killPointValue) : 2;

  let totalPts = 0;
  matchResults.forEach(r => {
    const kills = r.kills || 0;
    const placement = r.placement || 0;
    const pEntry = placementPoints.find(p => p.position === placement);
    const pPts = pEntry ? pEntry.points : 0;
    const kPts = kills * killPointValue;
    totalPts += (pPts + kPts);
  });

  return totalPts;
}

/**
 * Adapter: builds team match points across tournaments
 */
export function buildTeamFormHistory(teamId, tournaments = [], teamMatchResultsByTournament = {}) {
  const points = [];
  let hasUndatedTournaments = false;

  tournaments.forEach(tourney => {
    const results = teamMatchResultsByTournament[tourney.id] || [];
    const teamResults = results.filter(r => r.teamId === teamId);
    if (teamResults.length === 0) return;

    let eventDate = null;
    if (tourney.eventStartDate) {
      eventDate = new Date(tourney.eventStartDate);
    } else if (tourney.createdAt?.seconds) {
      eventDate = new Date(tourney.createdAt.seconds * 1000);
      hasUndatedTournaments = true;
    } else if (tourney.createdAt?.toDate) {
      eventDate = tourney.createdAt.toDate();
      hasUndatedTournaments = true;
    } else {
      eventDate = new Date(0);
      hasUndatedTournaments = true;
    }

    // Group by day + lobby
    const matchGroups = {};
    teamResults.forEach(r => {
      const key = `d${r.day}_l${r.lobby}`;
      if (!matchGroups[key]) matchGroups[key] = [];
      matchGroups[key].push(r);
    });

    Object.values(matchGroups).forEach(group => {
      const ppm = computeSingleMatchPPM(group, tourney.scoring);
      points.push({ date: eventDate, value: ppm });
    });
  });

  return { points, hasUndatedTournaments };
}

/**
 * Adapter: builds player match points across tournaments
 */
export function buildPlayerFormHistory(playerId, tournaments = [], playerMatchResultsByTournament = {}) {
  const points = [];
  let hasUndatedTournaments = false;

  tournaments.forEach(tourney => {
    const results = playerMatchResultsByTournament[tourney.id] || [];
    const playerResults = results.filter(r => r.playerId === playerId);
    if (playerResults.length === 0) return;

    let eventDate = null;
    if (tourney.eventStartDate) {
      eventDate = new Date(tourney.eventStartDate);
    } else if (tourney.createdAt?.seconds) {
      eventDate = new Date(tourney.createdAt.seconds * 1000);
      hasUndatedTournaments = true;
    } else if (tourney.createdAt?.toDate) {
      eventDate = tourney.createdAt.toDate();
      hasUndatedTournaments = true;
    } else {
      eventDate = new Date(0);
      hasUndatedTournaments = true;
    }

    playerResults.forEach(r => {
      points.push({ date: eventDate, value: r.kills || 0 });
    });
  });

  return { points, hasUndatedTournaments };
}

export function computeTeamGlobalForm(teamId, tournaments, teamMatchResultsByTournament) {
  const history = buildTeamFormHistory(teamId, tournaments, teamMatchResultsByTournament);
  const form = computeRollingForm(history.points);
  return {
    ...form,
    hasUndatedTournaments: history.hasUndatedTournaments,
  };
}

export function computePlayerGlobalForm(playerId, tournaments, playerMatchResultsByTournament) {
  const history = buildPlayerFormHistory(playerId, tournaments, playerMatchResultsByTournament);
  const form = computeRollingForm(history.points);
  return {
    ...form,
    hasUndatedTournaments: history.hasUndatedTournaments,
  };
}

/**
 * Human-readable form label based on decayed form, trend, confidence, and field average
 */
export function globalFormLabel(decayedForm, trend, confidence, fieldAvgForm = 0) {
  if (confidence === 'unranked' || decayedForm == null) return 'Unranked';
  const relative = fieldAvgForm > 0 ? decayedForm / fieldAvgForm : 1;

  if (trend === 'up' && relative > 1.15) return 'Red Hot';
  if (trend === 'up') return 'In Form';
  if (trend === 'flat' && relative > 1.1) return 'Steady High';
  if (trend === 'flat') return 'Steady';
  if (trend === 'down' && relative < 0.85) return 'Cold';
  if (trend === 'down') return 'Cooling Off';
  return 'Steady';
}

// ─── xG (Expected Kills) ──────────────────────────────────────────────────────

/**
 * Build match-point arrays for each of the three xG signals from a player's
 * raw match results list (all tournaments flattened).
 *
 * matchResults: Array of { kills, accuracy, damage, date }
 * Returns { killMatchPoints, accuracyMatchPoints, damageMatchPoints }
 */
export function buildPlayerXGHistory(matchResults) {
  const killMatchPoints     = [];
  const accuracyMatchPoints = [];
  const damageMatchPoints   = [];

  matchResults.forEach(r => {
    const date = r.date || null;
    killMatchPoints.push({ date, value: r.kills || 0 });
    if (r.accuracy != null && r.accuracy > 0) {
      accuracyMatchPoints.push({ date, value: r.accuracy });
    }
    if (r.damage != null && r.damage > 0) {
      damageMatchPoints.push({ date, value: r.damage });
    }
  });

  return { killMatchPoints, accuracyMatchPoints, damageMatchPoints };
}

/**
 * Given a single match's stats and the three independently-decayed baselines,
 * compute xG and the performance delta for that match.
 *
 * thisMatch: { kills, accuracy, damage }
 * decayedKills / decayedAccuracy / decayedDamage: numbers from computeRollingForm
 *
 * Returns { xG, performanceDelta } or null when baselines are missing.
 */
export function computeMatchXG(thisMatch, decayedKills, decayedAccuracy, decayedDamage) {
  if (!decayedKills || !decayedAccuracy || !decayedDamage) return null;
  const accuracyFactor = thisMatch.accuracy / decayedAccuracy;
  const damageFactor   = thisMatch.damage   / decayedDamage;
  const xG = decayedKills * accuracyFactor * damageFactor;
  return {
    xG:               Math.round(xG * 100) / 100,
    performanceDelta: Math.round((thisMatch.kills - xG) * 100) / 100, // + = overperformed
  };
}

/**
 * Compute career-level xG summary for a player given their full match history.
 *
 * matchResults: flat array of player match result objects, each with:
 *   { kills, accuracy, damage, date }
 *
 * Returns:
 *   {
 *     confidence: 'unranked' | 'provisional' | 'full',
 *     decayedKills, decayedAccuracy, decayedDamage,
 *     avgXG,            // average expected kills per match
 *     avgDelta,         // average actual - expected (career over/underperformance)
 *     matchXGs,         // per-match [{kills, xG, delta}, ...] (most recent first)
 *   }
 *   or null when confidence === 'unranked'
 */
export function computePlayerXGSummary(matchResults) {
  if (!matchResults || matchResults.length === 0) return null;

  const { killMatchPoints, accuracyMatchPoints, damageMatchPoints } =
    buildPlayerXGHistory(matchResults);

  const killForm     = computeRollingForm(killMatchPoints);
  const accuracyForm = computeRollingForm(accuracyMatchPoints);
  const damageForm   = computeRollingForm(damageMatchPoints);

  // Use the most conservative confidence across all three signals
  const confidenceRank = { unranked: 0, provisional: 1, full: 2 };
  const lowestConfidence = [killForm.confidence, accuracyForm.confidence, damageForm.confidence]
    .sort((a, b) => confidenceRank[a] - confidenceRank[b])[0];

  if (lowestConfidence === 'unranked') return { confidence: 'unranked' };

  const decayedKills    = killForm.decayedForm;
  const decayedAccuracy = accuracyForm.decayedForm;
  const decayedDamage   = damageForm.decayedForm;

  // Compute per-match xG for matches that have all three signals
  const eligible = matchResults.filter(
    r => r.accuracy != null && r.accuracy > 0 && r.damage != null && r.damage > 0
  );

  const matchXGs = eligible.map(r => {
    const result = computeMatchXG(r, decayedKills, decayedAccuracy, decayedDamage);
    return result ? { kills: r.kills, xG: result.xG, delta: result.performanceDelta } : null;
  }).filter(Boolean);

  const avgXG = matchXGs.length
    ? Math.round((matchXGs.reduce((s, m) => s + m.xG, 0) / matchXGs.length) * 100) / 100
    : null;

  const avgDelta = matchXGs.length
    ? Math.round((matchXGs.reduce((s, m) => s + m.delta, 0) / matchXGs.length) * 100) / 100
    : null;

  return {
    confidence:   lowestConfidence,
    decayedKills,
    decayedAccuracy,
    decayedDamage,
    avgXG,
    avgDelta,
    matchCount: matchXGs.length,
    matchXGs: [...matchXGs].reverse(), // most recent first
  };
}

