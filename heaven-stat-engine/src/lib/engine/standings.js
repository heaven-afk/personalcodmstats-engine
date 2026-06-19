/**
 * standings.js
 * Computes all standings views from raw match data + tournament config.
 * All functions are pure — no Firestore calls.
 */
import { getPlacementPoints, applyTiebreakers } from './scoring';

// ─── Daily standings ──────────────────────────────────────────────────────────
export function computeDailyStandings(teamMatchResults, bonusPoints, scoringConfig, day) {
  const { killPointValue = 2, placementPoints = [] } = scoringConfig;

  const dayResults = teamMatchResults.filter((r) => r.day === day);
  const dayBonuses = bonusPoints.filter((b) => b.day === day);

  const teamMap = {};

  for (const result of dayResults) {
    const key = result.teamId;
    if (!teamMap[key]) {
      teamMap[key] = {
        teamId: result.teamId,
        teamName: result.teamName || result.teamId,
        clanName: result.clanName || '',
        wins: 0, matches: 0,
        placementPts: 0, kills: 0, damage: 0,
        bonusPts: 0, sumOfPositions: 0,
        top3Finishes: 0,
        top5Finishes: 0,
        lobbyData: [],
      };
    }
    const t = teamMap[key];
    t.matches++;
    t.kills += result.kills || 0;
    t.damage += result.damage || 0;
    t.sumOfPositions += result.placement || 0;
    t.placementPts += getPlacementPoints(result.placement, placementPoints);
    if (result.placement === 1) t.wins++;
    if (result.placement <= 3) t.top3Finishes++;
    if (result.placement <= 5) t.top5Finishes++;
    t.lobbyData.push(result);
  }

  for (const bonus of dayBonuses) {
    if (teamMap[bonus.teamId]) {
      teamMap[bonus.teamId].bonusPts += bonus.amount || 0;
    }
  }

  const standings = Object.values(teamMap).map((t) => {
    const killPts = t.kills * killPointValue;
    return {
      ...t,
      killPts,
      totalPts: t.placementPts + killPts + t.bonusPts,
    };
  });

  return applyTiebreakers(standings);
}

// ─── Season collation ─────────────────────────────────────────────────────────
export function computeSeasonStandings(teamMatchResults, bonusPoints, scoringConfig) {
  const { killPointValue = 2, placementPoints = [] } = scoringConfig;

  const teamMap = {};

  for (const result of teamMatchResults) {
    const key = result.teamId;
    if (!teamMap[key]) {
      teamMap[key] = {
        teamId: result.teamId,
        teamName: result.teamName || result.teamId,
        clanName: result.clanName || '',
        wins: 0, matches: 0,
        placementPts: 0, kills: 0, damage: 0,
        bonusPts: 0, sumOfPositions: 0,
        top3Finishes: 0,
        top5Finishes: 0,
        activeDays: new Set(),
        perDay: {}, // day → { wins, matches, placePts, kills, totalPts, bonusPts }
      };
    }
    const t = teamMap[key];
    t.matches++;
    t.kills += result.kills || 0;
    t.damage += result.damage || 0;
    t.sumOfPositions += result.placement || 0;
    const ppts = getPlacementPoints(result.placement, placementPoints);
    t.placementPts += ppts;
    if (result.placement === 1) t.wins++;
    if (result.placement <= 3) t.top3Finishes++;
    if (result.placement <= 5) t.top5Finishes++;
    t.activeDays.add(result.day);

    // Per-day accumulation
    if (!t.perDay[result.day]) {
      t.perDay[result.day] = { wins: 0, matches: 0, placePts: 0, kills: 0, bonusPts: 0 };
    }
    t.perDay[result.day].matches++;
    t.perDay[result.day].kills += result.kills || 0;
    t.perDay[result.day].placePts += ppts;
    if (result.placement === 1) t.perDay[result.day].wins++;
  }

  for (const bonus of bonusPoints) {
    const key = bonus.teamId;
    if (teamMap[key]) {
      teamMap[key].bonusPts += bonus.amount || 0;
      if (!teamMap[key].perDay[bonus.day]) {
        teamMap[key].perDay[bonus.day] = { wins: 0, matches: 0, placePts: 0, kills: 0, bonusPts: 0 };
      }
      teamMap[key].perDay[bonus.day].bonusPts += bonus.amount || 0;
    }
  }

  const standings = Object.values(teamMap).map((t) => {
    const killPts = t.kills * killPointValue;
    const events = t.activeDays.size;

    // Finalize perDay totals
    const perDay = {};
    for (const [day, d] of Object.entries(t.perDay)) {
      const dKillPts = d.kills * killPointValue;
      perDay[day] = {
        ...d,
        killPts: dKillPts,
        totalPts: d.placePts + dKillPts + d.bonusPts,
      };
    }

    return {
      ...t,
      events,
      killPts,
      totalPts: t.placementPts + killPts + t.bonusPts,
      perDay,
      activeDays: [...t.activeDays].sort(),
    };
  });

  return applyTiebreakers(standings);
}

// ─── Team ranking (season with explicit rank numbers) ─────────────────────────
export function computeTeamRanking(teamMatchResults, bonusPoints, scoringConfig) {
  const standings = computeSeasonStandings(teamMatchResults, bonusPoints, scoringConfig);
  return standings.map((t, i) => ({ ...t, rank: i + 1 }));
}

// ─── Clan ranking (auto-derived) ──────────────────────────────────────────────
export function computeClanRanking(teamRanking) {
  const clanMap = {};

  for (const team of teamRanking) {
    const clan = team.clanName || 'No Clan';
    if (!clan || clan === 'No Clan') continue;
    if (!clanMap[clan]) {
      clanMap[clan] = {
        clanName: clan,
        teamCount: 0, wins: 0, matches: 0, events: 0,
        placementPts: 0, kills: 0, killPts: 0, bonusPts: 0, totalPts: 0,
        bestRank: Infinity, memberTeams: [],
      };
    }
    const c = clanMap[clan];
    c.teamCount++;
    c.wins += team.wins;
    c.matches += team.matches;
    c.events += team.events;
    c.placementPts += team.placementPts;
    c.kills += team.kills;
    c.killPts += team.killPts;
    c.bonusPts += team.bonusPts;
    c.totalPts += team.totalPts;
    c.bestRank = Math.min(c.bestRank, team.rank);
    c.memberTeams.push(team.teamName);
  }

  return Object.values(clanMap)
    .sort((a, b) => b.totalPts - a.totalPts || a.bestRank - b.bestRank)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
