/**
 * analytics.js
 * Full analytics engine — ALL formulas from the Excel templates.
 * Implements analytics from Team_Stats_Analysis_2026_v2.xlsx and Detailed_Team_Analysics_V1.xlsx
 */

import { computeSeasonStandings } from './standings';

// ─── Standard deviation helper ────────────────────────────────────────────────
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round1(n) { return Math.round(n * 10) / 10; }

// ─── Core analytics per team ──────────────────────────────────────────────────
function computeCoreAnalytics(team, scoringConfig) {
  const { killPointValue = 2, placementPoints = [] } = scoringConfig;
  const maxPlacementPoints = placementPoints.length > 0 ? Math.max(...placementPoints.map((p) => p.points)) : 25;
  const maxPosition = placementPoints.length > 0 ? Math.max(...placementPoints.map((p) => p.position)) : 25;

  const { wins, matches, events, placementPts, kills, bonusPts, totalPts, sumOfPositions, top3Finishes, top5Finishes } = team;

  // Core
  const PPM = matches > 0 ? round2(totalPts / matches) : 0;
  const KPM = matches > 0 ? round2(kills / matches) : 0;
  const avgPlace = matches > 0 ? round2(sumOfPositions / matches) : 0;
  const killPct = totalPts > 0 ? round2(((kills * killPointValue) / totalPts) * 100) : 0;
  const tKillPts = kills * killPointValue;

  // Insight Layer
  const placementEfficiency = matches > 0 ? round2(placementPts / matches) : 0;
  const top3Rate = matches > 0 ? round2((top3Finishes / matches) * 100) : 0;
  const top5Rate = matches > 0 ? round2((top5Finishes / matches) * 100) : 0;
  const top3vs5Spread = round2(top5Rate - top3Rate);
  const conversionRate = top5Finishes > 0 ? round2((wins / top5Finishes) * 100) : 0;
  const conversionRateTop3 = top3Finishes > 0 ? round2((wins / top3Finishes) * 100) : 0;
  const winRate = matches > 0 ? round2((wins / matches) * 100) : 0;

  // Momentum Index (needs per-day data)
  const perDay = team.perDay || {};
  const activeDays = Object.keys(perDay).map(Number).sort((a, b) => a - b);
  const mid = Math.ceil(activeDays.length / 2);
  const firstHalfDays = activeDays.slice(0, mid);
  const secondHalfDays = activeDays.slice(mid);

  const firstHalfPts = firstHalfDays.reduce((sum, d) => sum + (perDay[d]?.totalPts || 0), 0);
  const secondHalfPts = secondHalfDays.reduce((sum, d) => sum + (perDay[d]?.totalPts || 0), 0);
  const firstHalfMatches = firstHalfDays.reduce((sum, d) => sum + (perDay[d]?.matches || 0), 0);
  const secondHalfMatches = secondHalfDays.reduce((sum, d) => sum + (perDay[d]?.matches || 0), 0);

  const firstHalfPPM = firstHalfMatches > 0 ? firstHalfPts / firstHalfMatches : 0;
  const secondHalfPPM = secondHalfMatches > 0 ? secondHalfPts / secondHalfMatches : 0;

  let forwardMI = 0;
  if (firstHalfPPM === 0) {
    forwardMI = secondHalfPPM > 0 ? 1 : 0;
  } else {
    forwardMI = round2(secondHalfPPM / firstHalfPPM);
  }

  // Points Share Ratio & Place Dominance
  const placeDominanceIndex = matches > 0 ? round2((wins / matches) * 100) : 0;

  // Consistency Score
  const dPPM = activeDays.map((d) => {
    const pd = perDay[d];
    return {
      day: d,
      ppm: pd && pd.matches > 0 ? round2(pd.totalPts / pd.matches) : 0
    };
  });
  const ppmValues = dPPM.map((x) => x.ppm);
  const rangeCS = ppmValues.length > 1 ? round2(Math.max(...ppmValues) - Math.min(...ppmValues)) : 0;
  const stdDevCS = round2(stdDev(ppmValues));

  return {
    PPM, KPM, avgPlace, killPct, tKillPts,
    placementEfficiency, top3Rate, sumT3F: top3Finishes, conversionRate,
    conversionRateTop3, top5Finishes, top5Rate, top3vs5Spread,
    forwardMI, firstHalfPts, secondHalfPts,
    winRate, placeDominanceIndex,
    rangeCS, stdDevCS, dPPM,
    maxPlacementPoints, maxPosition,
  };
}

// ─── Normalization (0–100 scale) ──────────────────────────────────────────────
function normalize(val, minVal, maxVal) {
  if (maxVal === minVal) return 100;
  return Math.round(((val - minVal) / (maxVal - minVal)) * 100);
}

function normalizeAll(teams, metric) {
  const values = teams.map((t) => t.analytics?.[metric] ?? 0);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  return teams.map((t) => ({
    ...t,
    normalization: {
      ...t.normalization,
      [`N_${metric}`]: normalize(t.analytics?.[metric] ?? 0, minVal, maxVal),
    },
  }));
}

// ─── Playstyle / label helpers ────────────────────────────────────────────────
function playstyleLabel(power, placement, conversion) {
  const maxVal = Math.max(power, placement, conversion);
  const minVal = Math.min(power, placement, conversion);
  if (maxVal - minVal < 12) {
    return 'Balanced';
  }
  if (power === maxVal) {
    return conversion >= 65 ? 'Aggressive Clutch' : 'Aggressive';
  }
  if (placement === maxVal) {
    return conversion >= 65 ? 'Tactical Clutch' : 'Tactical';
  }
  return placement >= power ? 'Defensive' : 'Clutch';
}

function powerLabel(score) {
  if (score >= 80) return 'Elite';
  if (score >= 60) return 'Strong';
  if (score >= 40) return 'Balanced';
  if (score >= 20) return 'Passive';
  return 'Weak';
}

function placementLabel(score) {
  if (score >= 80) return 'Dominant';
  if (score >= 60) return 'Controlled';
  if (score >= 40) return 'Stable';
  if (score >= 20) return 'Unstable';
  return 'Struggling';
}

function conversionLabel(score) {
  if (score >= 80) return 'Clutch';
  if (score >= 60) return 'Efficient';
  if (score >= 40) return 'Average';
  if (score >= 20) return 'Wasteful';
  return 'Poor';
}

function formLabel(forwardMI, consistencyScore) {
  if (forwardMI > 1.15 && consistencyScore >= 60) return 'Red Hot';
  if (forwardMI > 1.0) return 'In Form';
  if (forwardMI >= 0.9 && forwardMI <= 1.0 && consistencyScore >= 60) return 'Steady';
  if (consistencyScore < 40) return 'Inconsistent';
  if (forwardMI < 0.85) return 'Cold';
  return 'Steady';
}

function teamRatingRankLabel(finalRating) {
  if (finalRating >= 850) return 'Elite Rank';
  if (finalRating >= 750) return 'Top Rank';
  if (finalRating >= 550) return 'Pro Rank';
  if (finalRating >= 380) return 'Mid Rank';
  if (finalRating >= 220) return 'Low Rank';
  return 'Entry Rank';
}

export function getTeamRatingRankLabel(finalRating) {
  return teamRatingRankLabel(finalRating);
}

// ─── Main analytics computation ───────────────────────────────────────────────
/**
 * Compute full analytics for all teams in a tournament.
 * Returns enriched team objects with analytics + normalization + component scores + labels.
 */
export function computeTeamAnalytics(teamMatchResults, bonusPoints, scoringConfig) {
  // Get season standings first
  const seasonStandings = computeSeasonStandings(teamMatchResults, bonusPoints, scoringConfig);

  if (seasonStandings.length === 0) return [];

  const allTeamsTotalPts = seasonStandings.reduce((sum, t) => sum + t.totalPts, 0);

  // Step 1: Core analytics per team
  let enriched = seasonStandings.map((team) => {
    const analytics = computeCoreAnalytics(team, scoringConfig);
    const pointsShareRatio = allTeamsTotalPts > 0
      ? round2((team.totalPts / allTeamsTotalPts) * 100)
      : 0;

    return {
      ...team,
      analytics: {
        ...analytics,
        pointsShareRatio,
      },
      normalization: {},
      scores: {},
    };
  });

  // Step 2: Normalize metrics across all teams
  const metricsToNormalize = [
    'PPM', 'KPM', 'winRate', 'killPct', 'conversionRate', 'conversionRateTop3', 'top3Rate', 'top5Rate', 'placementEfficiency', 'forwardMI'
  ];
  for (const metric of metricsToNormalize) {
    const values = enriched.map((t) => t.analytics[metric] ?? 0);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    enriched = enriched.map((t) => ({
      ...t,
      normalization: {
        ...t.normalization,
        [`N_${metric}`]: normalize(t.analytics[metric] ?? 0, minVal, maxVal),
      },
    }));
  }

  // Normalize consistencyScore (lower standard deviation is more consistent)
  const stdDevs = enriched.map((t) => t.analytics.stdDevCS ?? 0);
  const minStdDev = Math.min(...stdDevs);
  const maxStdDev = Math.max(...stdDevs);
  enriched = enriched.map((t) => {
    const consistencyScore = maxStdDev === minStdDev
      ? 100
      : round2(((maxStdDev - t.analytics.stdDevCS) / (maxStdDev - minStdDev)) * 100);
    return {
      ...t,
      normalization: {
        ...t.normalization,
        consistencyScore,
      },
    };
  });

  // Place Score — min-max normalize avgPlace across current field (lower is better, so max - avgPlace / max - min)
  const avgPlaces = enriched.map((t) => t.analytics.avgPlace ?? 0);
  const minAvgPlace = Math.min(...avgPlaces);
  const maxAvgPlace = Math.max(...avgPlaces);
  enriched = enriched.map((t) => {
    const avgPlace = t.analytics.avgPlace ?? 0;
    const placeScore = maxAvgPlace === minAvgPlace
      ? 100
      : round2(((maxAvgPlace - avgPlace) / (maxAvgPlace - minAvgPlace)) * 100);
    return {
      ...t,
      normalization: {
        ...t.normalization,
        placeScore,
      },
    };
  });

  // Step 3: Component scores
  enriched = enriched.map((t) => {
    const n = t.normalization;
    const POWER = Math.min(100, round2((n.N_PPM * 0.40) + (n.N_KPM * 0.35) + (n.N_killPct * 0.25)));
    const PLACEMENT = Math.min(100, round2((n.placeScore * 0.45) + (n.N_top5Rate * 0.30) + (n.N_placementEfficiency * 0.25)));
    const CONVERSION = Math.min(100, round2((n.N_winRate * 0.40) + (n.N_conversionRate * 0.40) + (n.N_conversionRateTop3 * 0.20)));
    const FORM = Math.min(100, round2((n.N_forwardMI * 0.55) + (n.consistencyScore * 0.45)));
    const TEAM_RATING = Math.min(100, round2((POWER * 0.35) + (PLACEMENT * 0.30) + (CONVERSION * 0.25) + (FORM * 0.10)));
    const FINAL_RATING = Math.min(1000, round2(TEAM_RATING * 10));

    return {
      ...t,
      scores: {
        POWER,
        PLACEMENT,
        CONVERSION,
        FORM,
        TEAM_RATING,
        FINAL_RATING,
        rankLabel: teamRatingRankLabel(FINAL_RATING),
      },
      labels: {
        playstyle: playstyleLabel(POWER, PLACEMENT, CONVERSION),
        powerLabel: powerLabel(POWER),
        placementLabel: placementLabel(PLACEMENT),
        conversionLabel: conversionLabel(CONVERSION),
        formLabel: formLabel(t.analytics.forwardMI, n.consistencyScore),
      },
    };
  });

  // Step 4: Identity Layer
  const avgTeamRating = enriched.reduce((sum, t) => sum + t.scores.TEAM_RATING, 0) / enriched.length;
  enriched = enriched.map((t) => {
    const { POWER, PLACEMENT, CONVERSION, FORM, TEAM_RATING } = t.scores;
    let identity = 'Balanced';
    if (POWER >= 60 && PLACEMENT >= 60 && CONVERSION >= 60 && FORM >= 60) {
      identity = 'Complete Team';
    } else if (TEAM_RATING < avgTeamRating && FORM >= 75) {
      identity = 'Dark Horse';
    } else if (FORM >= 80) {
      identity = 'Momentum Team';
    } else if (CONVERSION >= 80 && CONVERSION > POWER && CONVERSION > PLACEMENT) {
      identity = 'Closer';
    } else if (PLACEMENT >= 75 && PLACEMENT > POWER) {
      identity = 'Survivalist';
    } else if (POWER >= 75 && POWER > PLACEMENT) {
      identity = 'Slayer';
    }

    return {
      ...t,
      identity,
    };
  });

  // Sort by totalPts and tiebreakers descending
  return enriched
    .sort((a, b) => {
      if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
      if (b.placementPts !== a.placementPts) return b.placementPts - a.placementPts;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return b.wins - a.wins;
    })
    .map((t, i) => ({ ...t, analyticsRank: i + 1 }));
}
