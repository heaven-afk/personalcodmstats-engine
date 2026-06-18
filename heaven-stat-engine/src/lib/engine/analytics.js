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
function computeCoreAnalytics(team, allTeamsSeasonKills, scoringConfig, totalDays) {
  const { killPointValue = 2, placementPoints = [] } = scoringConfig;
  const maxPlacementPoints = placementPoints.length > 0 ? Math.max(...placementPoints.map((p) => p.points)) : 25;
  const maxPosition = placementPoints.length > 0 ? Math.max(...placementPoints.map((p) => p.position)) : 25;

  const { wins, matches, events, placementPts, kills, bonusPts, totalPts, sumOfPositions, top3Finishes } = team;

  // Core
  const PPM = matches > 0 ? round2(totalPts / matches) : 0;
  const KPM = matches > 0 ? round2(kills / matches) : 0;
  const avgPlace = matches > 0 ? round2(sumOfPositions / matches) : 0;
  const killPct = allTeamsSeasonKills > 0 ? round2((kills / allTeamsSeasonKills) * 100) : 0;
  const tKillPts = kills * killPointValue;

  // Insight Layer
  const placementEfficiency = matches > 0 && maxPlacementPoints > 0
    ? round2(placementPts / (matches * maxPlacementPoints) * 100)
    : 0;
  const top3Rate = matches > 0 ? round2((top3Finishes / matches) * 100) : 0;
  const conversionRate = matches > 0 ? round2((wins / matches) * 100) : 0;
  const winRate = conversionRate;

  // Momentum Index (needs per-day data)
  const perDay = team.perDay || {};
  const firstHalfDays = [1, 2, 3];
  const secondHalfDays = [4, 5, 6];
  const firstHalfPts = firstHalfDays.reduce((sum, d) => sum + (perDay[d]?.totalPts || 0), 0);
  const secondHalfPts = secondHalfDays.reduce((sum, d) => sum + (perDay[d]?.totalPts || 0), 0);
  const forwardMI = firstHalfPts > 0 ? round2(secondHalfPts / firstHalfPts) : 0;

  // Points Share Ratio & Place Dominance
  const placeDominanceIndex = matches > 0 ? round2((wins / matches) * 100) : 0;

  // Consistency Score — D1–D6 PPM
  const dPPM = [];
  for (let d = 1; d <= totalDays; d++) {
    const pd = perDay[d];
    if (pd && pd.matches > 0) {
      dPPM.push({ day: d, ppm: round2(pd.totalPts / pd.matches) });
    } else {
      dPPM.push({ day: d, ppm: 0 });
    }
  }
  const ppmValues = dPPM.map((x) => x.ppm);
  const rangeCS = ppmValues.length > 1 ? round2(Math.max(...ppmValues) - Math.min(...ppmValues)) : 0;
  const stdDevCS = round2(stdDev(ppmValues));

  return {
    PPM, KPM, avgPlace, killPct, tKillPts,
    placementEfficiency, top3Rate, sumT3F: top3Finishes, conversionRate,
    forwardMI, firstHalfPts, secondHalfPts,
    winRate, placeDominanceIndex,
    rangeCS, stdDevCS, dPPM,
    maxPlacementPoints, maxPosition,
  };
}

// ─── Normalization (0–100 scale) ──────────────────────────────────────────────
function normalize(val, minVal, maxVal) {
  if (maxVal === minVal) return 0;
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
function playstyleLabel(killPct, avgPlace) {
  if (killPct > 7 && avgPlace > 12) return 'Aggressive';
  if (killPct < 4 && avgPlace < 8) return 'Passive';
  return 'Balanced';
}

function powerLabel(score) {
  if (score >= 75) return 'Dominant';
  if (score >= 50) return 'Strong';
  if (score >= 25) return 'Average';
  return 'Weak';
}

function placementLabel(score) {
  if (score >= 75) return 'Elite';
  if (score >= 50) return 'Solid';
  if (score >= 25) return 'Developing';
  return 'Struggling';
}

function conversionLabel(score) {
  if (score >= 75) return 'Excellent';
  if (score >= 50) return 'Good';
  if (score >= 25) return 'Average';
  return 'Poor';
}

// ─── Main analytics computation ───────────────────────────────────────────────
/**
 * Compute full analytics for all teams in a tournament.
 * Returns enriched team objects with analytics + normalization + component scores + labels.
 */
export function computeTeamAnalytics(teamMatchResults, bonusPoints, scoringConfig, totalDays = 6) {
  // Get season standings first
  const seasonStandings = computeSeasonStandings(teamMatchResults, bonusPoints, scoringConfig);

  if (seasonStandings.length === 0) return [];

  // Total kills across all teams
  const allTeamsSeasonKills = seasonStandings.reduce((sum, t) => sum + t.kills, 0);
  const allTeamsTotalPts = seasonStandings.reduce((sum, t) => sum + t.totalPts, 0);

  // Step 1: Core analytics per team
  let enriched = seasonStandings.map((team) => {
    const analytics = computeCoreAnalytics(team, allTeamsSeasonKills, scoringConfig, totalDays);
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
  const metricsToNormalize = ['PPM', 'KPM', 'winRate', 'killPct', 'conversionRate', 'top3Rate'];
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

  // Place Score — inverted (lower avg place = higher score)
  enriched = enriched.map((t) => {
    const maxPos = t.analytics.maxPosition || 25;
    const placeScore = maxPos > 0 ? round2(100 - (t.analytics.avgPlace / maxPos) * 100) : 0;
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
    const POWER = round2((n.N_PPM * 0.4) + (n.N_KPM * 0.35) + (n.N_killPct * 0.25));
    const PLACEMENT = round2((n.placeScore * 0.4) + (n.N_top3Rate * 0.35) + (t.analytics.placementEfficiency * 0.0025 * 100));
    const CONVERSION = round2((n.N_winRate * 0.5) + (n.N_conversionRate * 0.5));
    const TEAM_RATING = round2((POWER * 0.40) + (PLACEMENT * 0.35) + (CONVERSION * 0.25));

    return {
      ...t,
      scores: {
        POWER,
        PLACEMENT: Math.min(100, PLACEMENT),
        CONVERSION,
        TEAM_RATING,
        FINAL_RATING: TEAM_RATING,
      },
      labels: {
        playstyle: playstyleLabel(t.analytics.killPct, t.analytics.avgPlace),
        powerLabel: powerLabel(POWER),
        placementLabel: placementLabel(Math.min(100, PLACEMENT)),
        conversionLabel: conversionLabel(CONVERSION),
      },
    };
  });

  // Sort by TEAM_RATING descending
  return enriched
    .sort((a, b) => b.scores.TEAM_RATING - a.scores.TEAM_RATING)
    .map((t, i) => ({ ...t, analyticsRank: i + 1 }));
}
