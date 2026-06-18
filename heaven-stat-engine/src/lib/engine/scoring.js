/**
 * scoring.js
 * Pure scoring helpers — placement point lookup, per-lobby score computation.
 * All functions are stateless and take only raw data + config.
 */

/**
 * Look up placement points from the tournament's placement table.
 * Returns 0 for any placement not in the table.
 */
export function getPlacementPoints(placement, placementTable = []) {
  const entry = placementTable.find((p) => p.position === placement);
  return entry ? entry.points : 0;
}

/**
 * Compute scores for a single lobby result.
 */
export function computeLobbyScore(result, scoringConfig) {
  const { killPointValue = 2, placementPoints = [] } = scoringConfig;
  const placementPts = getPlacementPoints(result.placement, placementPoints);
  const killPts = (result.kills || 0) * killPointValue;
  return {
    ...result,
    placementPts,
    killPts,
    totalPts: placementPts + killPts,
    isWin: result.placement === 1,
    isTop3: result.placement >= 1 && result.placement <= 3,
  };
}

/**
 * Compute scores for an array of lobby results.
 */
export function computeLobbyScores(results, scoringConfig) {
  return results.map((r) => computeLobbyScore(r, scoringConfig));
}

/**
 * Tiebreaker sort: Total Pts → Placement Pts → Total Kills → Wins
 */
export function applyTiebreakers(standings) {
  return [...standings].sort((a, b) => {
    if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
    if (b.placementPts !== a.placementPts) return b.placementPts - a.placementPts;
    if (b.kills !== a.kills) return b.kills - a.kills;
    return b.wins - a.wins;
  });
}
