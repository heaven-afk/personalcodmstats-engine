/**
 * globalAggregations.js
 *
 * Shared career-stat aggregation functions used by:
 *   - src/app/api/overlay/rankings/route.js
 *   - src/app/api/overlay/profile/route.js
 *   - src/app/api/overlay/compare/route.js
 *
 * TODO: src/app/(app)/comparison/page.jsx still has its own inline copies of
 * aggregateTeams / aggregatePlayers. Once the overlay API is stable, those
 * inline copies should be replaced with imports from this module to eliminate
 * drift between the two implementations.
 *
 * The pure aggregation functions (aggregateTeamData, aggregatePlayerData) take
 * pre-fetched data as arguments so they remain testable without Firestore.
 * The async wrappers (aggregateGlobalTeams, aggregateGlobalPlayers) handle all
 * Firestore fetching and delegate to those pure functions.
 */

import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import { computeTeamAnalytics, getTeamRatingRankLabel } from '@/lib/engine/analytics';

// ─── Pure aggregation: teams ──────────────────────────────────────────────────
/**
 * Aggregate career team stats from pre-fetched data arrays.
 * Mirrors the aggregateTeams function in comparison/page.jsx.
 *
 * @param {Array} registryTeams    - All teams from the global registry
 * @param {Array} tournaments      - All tournament documents
 * @param {Array[]} allTeamRegs    - Per-tournament team registration arrays (parallel to tournaments)
 * @param {Array[]} allTeamRes     - Per-tournament team match result arrays (parallel to tournaments)
 * @param {Array[]} allTeamBonuses - Per-tournament bonus point arrays (parallel to tournaments)
 * @returns {Array} Enriched team objects with career stats
 */
export function aggregateTeamData(registryTeams, tournaments, allTeamRegs, allTeamRes, allTeamBonuses) {
  const teamMap = {};
  registryTeams.forEach((t) => {
    teamMap[t.id] = {
      ...t,
      careerWins: 0,
      careerMatches: 0,
      careerPlacementPts: 0,
      careerKills: 0,
      careerBonusPts: 0,
      careerTotalPts: 0,
      tournamentsCount: 0,
      totalTeamRating: 0,
      teamRatingCount: 0,
      careerRankSum: 0,
      tournamentWins: 0,
      tournamentPPM: 0,
      tournamentKPM: 0,
      tournamentTop3Rate: 0,
      tournamentTop5Rate: 0,
    };
  });

  tournaments.forEach((tourney, index) => {
    const tourneyAnalytics = computeTeamAnalytics(
      allTeamRes[index] || [],
      allTeamBonuses[index] || [],
      tourney.scoring || {}
    );
    const analyticsMap = {};
    tourneyAnalytics.forEach((ta) => {
      analyticsMap[ta.teamId] = ta;
    });

    const ranking = computeTeamRanking(
      allTeamRes[index] || [],
      allTeamBonuses[index] || [],
      tourney.scoring || {}
    );
    ranking.forEach((tr) => {
      const reg = (allTeamRegs[index] || []).find((r) => r.teamId === tr.teamId);
      if (reg && teamMap[tr.teamId]) {
        const tm = teamMap[tr.teamId];
        tm.careerWins         += tr.wins || 0;
        tm.careerMatches      += tr.matches || 0;
        tm.careerPlacementPts += tr.placementPts || 0;
        tm.careerKills        += tr.kills || 0;
        tm.careerBonusPts     += tr.bonusPts || 0;
        tm.careerTotalPts     += tr.totalPts || 0;
        tm.tournamentsCount   += 1;
        tm.careerRankSum      += tr.rank || 0;
        if (tr.rank === 1) tm.tournamentWins += 1;

        const teamAnalytics = analyticsMap[tr.teamId];
        if (teamAnalytics) {
          tm.tournamentPPM      = teamAnalytics.analytics?.PPM || 0;
          tm.tournamentKPM      = teamAnalytics.analytics?.KPM || 0;
          tm.tournamentTop3Rate = teamAnalytics.analytics?.top3Rate || 0;
          tm.tournamentTop5Rate = teamAnalytics.analytics?.top5Rate || 0;

          if (teamAnalytics.scores && typeof teamAnalytics.scores.FINAL_RATING === 'number') {
            tm.totalTeamRating += teamAnalytics.scores.FINAL_RATING;
            tm.teamRatingCount += 1;
          }
        }
      }
    });
  });

  return Object.values(teamMap)
    .map((t) => {
      const avgRating = t.teamRatingCount > 0 ? t.totalTeamRating / t.teamRatingCount : 0;
      return {
        ...t,
        winRate:           t.careerMatches > 0 ? (t.careerWins / t.careerMatches) * 100 : 0,
        avgPointsPerMatch: t.careerMatches > 0 ? t.careerTotalPts / t.careerMatches : 0,
        avgKillsPerMatch:  t.careerMatches > 0 ? t.careerKills / t.careerMatches : 0,
        careerAvgTeamRating: avgRating,
        careerAvgTeamRatingLabel: getTeamRatingRankLabel(avgRating),
        avgPlacementPtsPerTournament: t.tournamentsCount > 0 ? t.careerPlacementPts / t.tournamentsCount : 0,
        avgRankedPosition: t.tournamentsCount > 0 ? t.careerRankSum / t.tournamentsCount : 0,
      };
    })
    .filter((t) => t.careerMatches > 0 || t.tournamentsCount > 0);
}

// ─── Pure aggregation: players ────────────────────────────────────────────────
/**
 * Aggregate career player stats from pre-fetched data arrays.
 * Mirrors the aggregatePlayers function in comparison/page.jsx.
 *
 * @param {Array} registryPlayers - All players from the global registry
 * @param {Array[]} allPlayerRegs - Per-tournament player registration arrays (parallel to tournaments)
 * @param {Array[]} allPlayerRes  - Per-tournament player match result arrays (parallel to tournaments)
 * @returns {Array} Enriched player objects with career stats
 */
export function aggregatePlayerData(registryPlayers, allPlayerRegs, allPlayerRes) {
  const playerMap = {};
  registryPlayers.forEach((p) => {
    playerMap[p.id] = {
      ...p,
      careerKills: 0,
      careerMatches: 0,
      careerDamage: 0,
      careerAccuracySum: 0,
      careerAccuracyCount: 0,
      tournamentsCount: 0,
      lastClass: 'Class 1',
      teamId: '',
      teamName: '—',
    };
  });

  allPlayerRegs.forEach((regs) => {
    regs.forEach((reg) => {
      if (playerMap[reg.playerId]) {
        const pm = playerMap[reg.playerId];
        pm.tournamentsCount += 1;
        if (reg.class) pm.lastClass = reg.class;
        if (reg.teamId) { pm.teamId = reg.teamId; pm.teamName = reg.teamName || '—'; }
      }
    });
  });

  allPlayerRes.forEach((results) => {
    results.forEach((res) => {
      if (playerMap[res.playerId]) {
        const pm = playerMap[res.playerId];
        pm.careerKills   += res.kills || 0;
        pm.careerMatches += 1;
        pm.careerDamage  += res.damage || 0;
        if (res.accuracy != null && res.accuracy > 0) {
          pm.careerAccuracySum   += res.accuracy;
          pm.careerAccuracyCount += 1;
        }
      }
    });
  });

  return Object.values(playerMap)
    .map((p) => ({
      ...p,
      avgKillsPerMatch:   p.careerMatches > 0 ? p.careerKills / p.careerMatches : 0,
      avgDamagePerMatch:  p.careerMatches > 0 ? Math.round(p.careerDamage / p.careerMatches) : 0,
      avgAccuracy:        p.careerAccuracyCount > 0 ? p.careerAccuracySum / p.careerAccuracyCount : 0,
      killsPerTournament: p.tournamentsCount > 0 ? p.careerKills / p.tournamentsCount : 0,
      damagePerKill:      p.careerKills > 0 ? p.careerDamage / p.careerKills : 0,
    }))
    .filter((p) => p.careerMatches > 0 || p.tournamentsCount > 0);
}

// ─── Async wrappers (handle Firestore fetching) ───────────────────────────────

/**
 * Fetch all tournaments + their match data and return aggregated career team stats.
 * This is the function API routes should call directly.
 */
export async function aggregateGlobalTeams() {
  const [registryTeams, tournaments] = await Promise.all([
    getTeams(),
    getTournaments(),
  ]);

  if (tournaments.length === 0) return [];

  const [allTeamRegs, allTeamRes, allTeamBonuses] = await Promise.all([
    Promise.all(tournaments.map((t) => getTeamRegistrations(t.id))),
    Promise.all(tournaments.map((t) => getTeamMatchResults(t.id))),
    Promise.all(tournaments.map((t) => getBonusPoints(t.id))),
  ]);

  return aggregateTeamData(registryTeams, tournaments, allTeamRegs, allTeamRes, allTeamBonuses);
}

/**
 * Fetch all tournaments + their match data and return aggregated career player stats.
 * This is the function API routes should call directly.
 */
export async function aggregateGlobalPlayers() {
  const [registryPlayers, tournaments] = await Promise.all([
    getPlayers(),
    getTournaments(),
  ]);

  if (tournaments.length === 0) return [];

  const [allPlayerRegs, allPlayerRes] = await Promise.all([
    Promise.all(tournaments.map((t) => getPlayerRegistrations(t.id))),
    Promise.all(tournaments.map((t) => getPlayerMatchResults(t.id))),
  ]);

  return aggregatePlayerData(registryPlayers, allPlayerRegs, allPlayerRes);
}
