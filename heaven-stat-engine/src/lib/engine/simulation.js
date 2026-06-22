/**
 * simulation.js
 * Cross-Event Simulation Engine — pure computation layer.
 *
 * Responsibilities:
 *   1. Re-score historical match data under a new event's point system.
 *   2. Build a simulated roster with the three-level rating fallback cascade.
 *   3. Compute placement ranges (predicted rank + uncertainty band).
 *
 * This module is a read-only consumer of the existing engine:
 *   - computeTeamAnalytics  (analytics.js) — called with re-scored team data
 *   - computePlayerAnalytics (playerStats.js) — called for Level-2 player fallback
 *   - computePlayerStats     (playerStats.js) — intermediate step for player fallback
 *
 * NEVER write to Firestore or localStorage from here.
 */

import { computeTeamAnalytics } from './analytics';
import { computePlayerStats, computePlayerAnalytics } from './playerStats';
import { getPlacementPoints } from './scoring';

// ─── 1. Re-scoring helpers ─────────────────────────────────────────────────────

/**
 * Re-score an array of raw team match results under a new scoring config.
 *
 * Each input row is the shape stored in Firestore teamMatchResults:
 *   { teamId, teamName, clanName, day, lobby, placement, kills, damage, ... }
 *
 * The output is the same shape with placementPts / killPts / totalPts replaced
 * by values computed from newScoringConfig.  All other fields are preserved.
 *
 * This does NOT mutate the input array.
 *
 * @param {object[]} teamMatchResults  Raw rows from one or more source tournaments.
 * @param {object}   newScoringConfig  { killPointValue, placementPoints[] }
 * @returns {object[]} Re-scored rows, same shape.
 */
export function rescoreTeamMatchResults(teamMatchResults, newScoringConfig) {
  const { killPointValue = 2, placementPoints = [] } = newScoringConfig;
  return teamMatchResults.map((r) => {
    const rescored_placement_pts = getPlacementPoints(r.placement, placementPoints);
    const rescored_kill_pts      = (r.kills || 0) * killPointValue;
    return {
      ...r,
      // Overwrite scoring fields only; keep placement, kills, day, lobby intact
      placementPts: rescored_placement_pts,
      killPts:      rescored_kill_pts,
      totalPts:     rescored_placement_pts + rescored_kill_pts,
    };
  });
}

/**
 * Re-score an array of raw player match results under a new scoring config.
 *
 * Player results don't carry placement directly — placement belongs to the team.
 * We look it up via a placement lookup built from the (already re-scored) team
 * match results: key = `${day}_${lobby}_${teamId}`.
 *
 * Only the kill-based score is re-derived for players (placement is used to
 * reconstruct team-level context for computePlayerAnalytics).
 *
 * @param {object[]} playerMatchResults   Raw rows from source tournaments.
 * @param {object[]} rescoredTeamResults  Already re-scored team match results.
 * @param {object}   newScoringConfig     { killPointValue, placementPoints[] }
 * @returns {object[]} Player rows with updated kill scoring context.
 */
export function rescorePlayerMatchResults(
  playerMatchResults,
  rescoredTeamResults,
  newScoringConfig
) {
  const { killPointValue = 2 } = newScoringConfig;

  // Build placement lookup from re-scored team results
  const placementLookup = {};
  for (const r of rescoredTeamResults) {
    const key = `${r.day}_${r.lobby}_${r.teamId}`;
    placementLookup[key] = r.placement;
  }

  return playerMatchResults.map((r) => {
    const rescored_kill_pts = (r.kills || 0) * killPointValue;
    const teamKey = `${r.day}_${r.lobby}_${r.teamId}`;
    return {
      ...r,
      rescored_kill_pts,
      // Carry resolved placement so computePlayerAnalytics can use the lookup
      _resolvedPlacement: placementLookup[teamKey] ?? null,
    };
  });
}

// ─── 2. Fallback cascade ───────────────────────────────────────────────────────

/**
 * Resolve a single team's rating via the three-level cascade.
 *
 * Level 1 — Own history:
 *   Team has match data in the re-scored team results.
 *   → call computeTeamAnalytics on that subset, use FINAL_RATING.
 *
 * Level 2 — Player-based reconstruction:
 *   Team has no direct history but ≥1 roster player has player-level history.
 *   → run computePlayerAnalytics on re-scored player results for those players,
 *     average their RATING scores as the team estimate.
 *
 * Level 3 — Field baseline:
 *   No data at all → placeholder assigned later by the caller.
 *
 * @returns {{ level: 1|2|3, FINAL_RATING: number|null, analyticsDetail: object|null }}
 */
function resolveTeamRating(
  rosterEntry,          // { teamId, teamName, playerIds: string[] }
  rescoredTeamResults,  // all re-scored team match rows
  rescoredPlayerResults,// all re-scored player match rows
  newScoringConfig,
  globalPlayersById     // map of playerId → player registry record
) {
  const { teamId, teamName, playerIds = [] } = rosterEntry;

  // ── Level 1: own team history ──────────────────────────────────────────────
  const ownTeamRows = rescoredTeamResults.filter(
    (r) => r.teamId === teamId || r.teamName === teamName
  );

  if (ownTeamRows.length > 0) {
    const analyticsResults = computeTeamAnalytics(ownTeamRows, [], newScoringConfig);
    // computeTeamAnalytics returns sorted array; first entry is this team's data
    const teamData = analyticsResults.find(
      (t) => t.teamId === teamId || t.teamName === teamName
    ) || analyticsResults[0];

    return {
      level: 1,
      FINAL_RATING: teamData?.scores?.FINAL_RATING ?? 0,
      TEAM_RATING:  teamData?.scores?.TEAM_RATING ?? 0,
      analyticsDetail: teamData ?? null,
    };
  }

  // ── Level 2: player-based reconstruction ──────────────────────────────────
  if (playerIds.length > 0) {
    const playerRows = rescoredPlayerResults.filter(
      (r) => playerIds.includes(r.playerId)
    );

    if (playerRows.length > 0) {
      // Build synthetic player registrations (minimal shape needed by computePlayerStats)
      const syntheticRegs = playerIds.map((pid) => {
        const globalPlayer = globalPlayersById[pid];
        return {
          playerId: pid,
          teamId: teamId || teamName,
          ign: globalPlayer?.ign || globalPlayer?.professionalName || pid,
          class: '', slot: 0,
        };
      });

      // Compute raw player stats from re-scored player rows
      const playerStats = computePlayerStats(playerRows, syntheticRegs, {
        structure: { playerClasses: [], totalDays: 99, lobbiesPerDay: 99 },
      });

      // Compute analytics; pass re-scored team results for placement context
      const playerAnalytics = computePlayerAnalytics(playerStats, rescoredTeamResults);

      if (playerAnalytics.length > 0) {
        const avgRating =
          playerAnalytics.reduce((sum, p) => sum + (p.scores?.RATING ?? 0), 0) /
          playerAnalytics.length;
        const avgFinalRating = Math.min(1000, Math.round(avgRating * 10));

        return {
          level: 2,
          FINAL_RATING: avgFinalRating,
          TEAM_RATING:  Math.round(avgRating * 100) / 100,
          analyticsDetail: { playerBreakdown: playerAnalytics },
        };
      }
    }
  }

  // ── Level 3: no data ───────────────────────────────────────────────────────
  return { level: 3, FINAL_RATING: null, TEAM_RATING: null, analyticsDetail: null };
}

// ─── 3. Placement range computation ───────────────────────────────────────────

/**
 * Given a sorted list of simulated teams (already sorted by FINAL_RATING desc),
 * compute placement ranges for each entry.
 *
 * Range width multiplier by level:
 *   Level 1 (own history)     → ±1 rank
 *   Level 2 (player estimate) → ±2 ranks
 *   Level 3 (field average)   → ±3 ranks
 *
 * Ranges are clamped to [1, teamCount].
 */
function computePlacementRanges(sortedTeams) {
  const n = sortedTeams.length;
  const SPREAD = { 1: 1, 2: 2, 3: 3 };

  return sortedTeams.map((team, i) => {
    const predictedRank = i + 1;
    const spread = SPREAD[team.level] ?? 3;
    const rangeLow  = Math.max(1, predictedRank - spread);
    const rangeHigh = Math.min(n, predictedRank + spread);
    return { ...team, predictedRank, rangeLow, rangeHigh };
  });
}

// ─── 4. Main entry point ──────────────────────────────────────────────────────

/**
 * Build the full simulation.
 *
 * @param {object}   params
 * @param {object[]} params.sourceTournamentData
 *   Array of { teamMatchResults, playerMatchResults } for each selected source tournament.
 * @param {object}   params.newScoringConfig
 *   { killPointValue, placementPoints[] } — the upcoming event's point system.
 * @param {object[]} params.rosterEntries
 *   Array of { teamId, teamName, playerIds[] } — the participating teams.
 * @param {object[]} params.globalPlayers
 *   Full player registry (from getPlayers()).
 *
 * @returns {object[]} Sorted simulated standings with placement ranges.
 *   Each entry: { teamId, teamName, level, FINAL_RATING, TEAM_RATING,
 *                 predictedRank, rangeLow, rangeHigh, analyticsDetail }
 */
export function runSimulation({
  sourceTournamentData,
  newScoringConfig,
  rosterEntries,
  globalPlayers = [],
}) {
  // ── Build global player lookup ─────────────────────────────────────────────
  const globalPlayersById = {};
  for (const p of globalPlayers) {
    globalPlayersById[p.id] = p;
  }

  // ── Merge and re-score all source tournament data ──────────────────────────
  const allRawTeamResults   = sourceTournamentData.flatMap((d) => d.teamMatchResults   || []);
  const allRawPlayerResults = sourceTournamentData.flatMap((d) => d.playerMatchResults || []);

  const rescoredTeamResults   = rescoreTeamMatchResults(allRawTeamResults, newScoringConfig);
  const rescoredPlayerResults = rescorePlayerMatchResults(
    allRawPlayerResults,
    rescoredTeamResults,
    newScoringConfig
  );

  // ── Resolve each roster entry through the fallback cascade ─────────────────
  const resolved = rosterEntries.map((entry) =>
    resolveTeamRating(
      entry,
      rescoredTeamResults,
      rescoredPlayerResults,
      newScoringConfig,
      globalPlayersById
    )
  );

  // ── Compute field-average rating for Level-3 fallbacks ────────────────────
  const level1and2Ratings = resolved
    .filter((r) => r.level !== 3 && r.FINAL_RATING !== null)
    .map((r) => r.FINAL_RATING);

  const fieldAvgRating =
    level1and2Ratings.length > 0
      ? Math.round(level1and2Ratings.reduce((a, b) => a + b, 0) / level1and2Ratings.length)
      : 500; // neutral midpoint if literally no one has any data

  // ── Assemble final entries ─────────────────────────────────────────────────
  const simEntries = rosterEntries.map((entry, i) => {
    const resolution = resolved[i];
    const finalRating =
      resolution.level === 3 ? fieldAvgRating : (resolution.FINAL_RATING ?? fieldAvgRating);
    const teamRating =
      resolution.level === 3
        ? Math.round(fieldAvgRating / 10)
        : (resolution.TEAM_RATING ?? Math.round(fieldAvgRating / 10));

    return {
      teamId:          entry.teamId   || entry.teamName,
      teamName:        entry.teamName || entry.teamId,
      level:           resolution.level,
      FINAL_RATING:    finalRating,
      TEAM_RATING:     teamRating,
      analyticsDetail: resolution.analyticsDetail,
    };
  });

  // ── Sort by FINAL_RATING desc, tiebreak by teamName ───────────────────────
  const sorted = [...simEntries].sort((a, b) => {
    if (b.FINAL_RATING !== a.FINAL_RATING) return b.FINAL_RATING - a.FINAL_RATING;
    return a.teamName.localeCompare(b.teamName);
  });

  // ── Assign predicted ranks and placement ranges ────────────────────────────
  return computePlacementRanges(sorted);
}

// ─── 5. Export helpers ─────────────────────────────────────────────────────────

/** Human-readable label for the confidence level. */
export function levelLabel(level) {
  if (level === 1) return 'Own History';
  if (level === 2) return 'Player Estimate';
  return 'No Data — Field Avg';
}

/** CSS-compatible confidence tier for badge coloring. */
export function levelTier(level) {
  if (level === 1) return 'own';
  if (level === 2) return 'player';
  return 'field';
}
