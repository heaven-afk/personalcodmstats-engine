/**
 * playerRecords.js
 * Esports analytics engine helper to compute:
 * 1. Tournament-wide player leaders & single-match record holders
 * 2. Team-level squad leaders & detailed roster performance breakdown
 */

/**
 * Format a match reference string: e.g. "D1 L2"
 */
export function formatMatchRef(day, lobby) {
  if (day == null && lobby == null) return '—';
  return `D${day} L${lobby}`;
}

/**
 * Compute tournament-wide player leaders and peak single-match records
 * @param {Array} playerAnalyticsData - Enriched player analytics objects
 * @param {Array} playerMatchResults - Raw player match results rows
 */
export function computeTournamentPlayerRecords(playerAnalyticsData = [], playerMatchResults = []) {
  if (!playerAnalyticsData || playerAnalyticsData.length === 0) {
    return {
      mvp: null,
      topKills: null,
      bestAvgDamage: null,
      bestAvgAccuracy: null,
      peakDamageMatch: null,
      peakAccuracyMatch: null,
      peakKillsMatch: null,
      bestExecution: null,
    };
  }

  // 1. Tournament MVP: best player based on analyticsRank (or FINAL_RATING)
  const sortedByRank = [...playerAnalyticsData].sort((a, b) => {
    const rankA = a.analyticsRank ?? 9999;
    const rankB = b.analyticsRank ?? 9999;
    if (rankA !== rankB) return rankA - rankB;
    return (b.scores?.FINAL_RATING || 0) - (a.scores?.FINAL_RATING || 0);
  });
  const mvp = sortedByRank[0] || null;

  // 2. Top Fragger / Most Total Kills
  const sortedByKills = [...playerAnalyticsData].sort((a, b) => {
    if ((b.totalKills || 0) !== (a.totalKills || 0)) {
      return (b.totalKills || 0) - (a.totalKills || 0);
    }
    const kpmA = a.analytics?.KPM ?? a.killsPerMatch ?? 0;
    const kpmB = b.analytics?.KPM ?? b.killsPerMatch ?? 0;
    return kpmB - kpmA;
  });
  const topKills = sortedByKills[0] || null;

  // 3. Best Average Damage (minimum 1 match)
  const sortedByAvgDmg = [...playerAnalyticsData]
    .filter(p => (p.totalMatches || 0) > 0)
    .sort((a, b) => {
      const dmgA = a.avgDamage ?? (a.totalMatches > 0 ? a.totalDamage / a.totalMatches : 0);
      const dmgB = b.avgDamage ?? (b.totalMatches > 0 ? b.totalDamage / b.totalMatches : 0);
      return dmgB - dmgA;
    });
  const bestAvgDamage = sortedByAvgDmg[0] || null;

  // 4. Best Average Accuracy (only players with accuracy readings)
  const sortedByAvgAcc = [...playerAnalyticsData]
    .filter(p => (p.accuracyCount || 0) > 0 && (p.avgAccuracy || 0) > 0)
    .sort((a, b) => (b.avgAccuracy || 0) - (a.avgAccuracy || 0));
  const bestAvgAccuracy = sortedByAvgAcc[0] || null;

  // 5. Best Execution Ratio (Damage per Kill) — minimum 5 kills
  const sortedByExecution = [...playerAnalyticsData]
    .filter(p => (p.totalKills || 0) >= 5 && (p.totalDamage || 0) > 0)
    .map(p => ({
      ...p,
      dpk: Math.round((p.totalDamage / p.totalKills) * 10) / 10,
    }))
    .sort((a, b) => a.dpk - b.dpk);
  const bestExecution = sortedByExecution[0] || null;

  // 6. Single-Match Peak Records from raw match results
  let peakDamageMatch = null;
  let peakAccuracyMatch = null;
  let peakKillsMatch = null;

  if (Array.isArray(playerMatchResults) && playerMatchResults.length > 0) {
    for (const r of playerMatchResults) {
      if (!r) continue;
      const playerName = r.playerName || r.ign || 'Unknown';
      const teamName = r.teamName || '';
      const matchRef = formatMatchRef(r.day, r.lobby);

      // Peak Damage
      const dmg = Number(r.damage);
      if (!isNaN(dmg) && dmg > 0) {
        if (!peakDamageMatch || dmg > peakDamageMatch.value) {
          peakDamageMatch = {
            value: Math.round(dmg),
            playerId: r.playerId,
            playerName,
            teamName,
            day: r.day,
            lobby: r.lobby,
            matchRef,
          };
        }
      }

      // Peak Accuracy
      const acc = Number(r.accuracy);
      if (!isNaN(acc) && acc > 0 && acc <= 100) {
        if (!peakAccuracyMatch || acc > peakAccuracyMatch.value) {
          peakAccuracyMatch = {
            value: Math.round(acc * 10) / 10,
            playerId: r.playerId,
            playerName,
            teamName,
            day: r.day,
            lobby: r.lobby,
            matchRef,
          };
        }
      }

      // Peak Kills
      const kills = Number(r.kills);
      if (!isNaN(kills) && kills > 0) {
        if (!peakKillsMatch || kills > peakKillsMatch.value) {
          peakKillsMatch = {
            value: kills,
            playerId: r.playerId,
            playerName,
            teamName,
            day: r.day,
            lobby: r.lobby,
            matchRef,
          };
        }
      }
    }
  }

  return {
    mvp,
    topKills,
    bestAvgDamage,
    bestAvgAccuracy,
    peakDamageMatch,
    peakAccuracyMatch,
    peakKillsMatch,
    bestExecution,
  };
}

/**
 * Compute team roster analytics including squad leaders, single match peaks,
 * damage share %, kill share %, and lethal execution efficiency.
 * @param {string} teamId - The selected team's ID
 * @param {string} teamName - The selected team's name
 * @param {Array} playerAnalyticsData - Enriched player analytics objects
 * @param {Array} playerMatchResults - Raw player match results rows
 * @param {Array} teamMatchResults - Raw team match results rows
 */
export function computeTeamRosterAnalytics(
  teamId,
  teamName = '',
  playerAnalyticsData = [],
  playerMatchResults = [],
  teamMatchResults = []
) {
  if (!teamId && !teamName) {
    return {
      roster: [],
      squadLeaders: {
        mvp: null,
        topFragger: null,
        damageLeader: null,
        accuracyLeader: null,
        peakDamage: null,
        peakKills: null,
      },
      teamTotals: {
        kills: 0,
        damage: 0,
        matches: 0,
      },
    };
  }

  const cleanTeamId = String(teamId || '').trim();
  const cleanTeamName = String(teamName || '').trim().toLowerCase();

  // Match players for this team
  const teamPlayers = (playerAnalyticsData || []).filter(p => {
    if (cleanTeamId && p.teamId && String(p.teamId).trim() === cleanTeamId) return true;
    if (cleanTeamName && p.teamName && String(p.teamName).trim().toLowerCase() === cleanTeamName) return true;
    return false;
  });

  // Filter raw player match results for this team
  const teamRawMatches = (playerMatchResults || []).filter(r => {
    if (cleanTeamId && r.teamId && String(r.teamId).trim() === cleanTeamId) return true;
    if (cleanTeamName && r.teamName && String(r.teamName).trim().toLowerCase() === cleanTeamName) return true;
    if (teamPlayers.some(p => p.playerId === r.playerId)) return true;
    return false;
  });

  // Calculate team total damage and kills from player match records
  const teamTotalDamage = teamRawMatches.reduce((sum, r) => sum + (Number(r.damage) || 0), 0) ||
    teamPlayers.reduce((sum, p) => sum + (p.totalDamage || 0), 0);

  const teamTotalKills = teamRawMatches.reduce((sum, r) => sum + (Number(r.kills) || 0), 0) ||
    teamPlayers.reduce((sum, p) => sum + (p.totalKills || 0), 0);

  // Group raw matches by player ID or name
  const matchesByPlayer = {};
  for (const r of teamRawMatches) {
    const key = r.playerId || r.playerName;
    if (!key) continue;
    if (!matchesByPlayer[key]) matchesByPlayer[key] = [];
    matchesByPlayer[key].push(r);
  }

  // Build detailed roster list
  const roster = teamPlayers.map(p => {
    const pMatches = matchesByPlayer[p.playerId] || matchesByPlayer[p.playerName] || [];

    // Compute peak single match kills
    let peakKills = 0;
    let peakKillsMatch = '—';
    // Compute peak single match damage
    let peakDamage = 0;
    let peakDamageMatch = '—';
    // Compute peak single match accuracy
    let peakAccuracy = 0;
    let peakAccuracyMatch = '—';

    for (const m of pMatches) {
      const k = Number(m.kills) || 0;
      if (k > peakKills) {
        peakKills = k;
        peakKillsMatch = formatMatchRef(m.day, m.lobby);
      }
      const d = Number(m.damage) || 0;
      if (d > peakDamage) {
        peakDamage = Math.round(d);
        peakDamageMatch = formatMatchRef(m.day, m.lobby);
      }
      const a = Number(m.accuracy);
      if (!isNaN(a) && a > peakAccuracy && a <= 100) {
        peakAccuracy = Math.round(a * 10) / 10;
        peakAccuracyMatch = formatMatchRef(m.day, m.lobby);
      }
    }

    const matchesCount = p.totalMatches || pMatches.length || 0;
    const totalKills = p.totalKills ?? pMatches.reduce((s, m) => s + (Number(m.kills) || 0), 0);
    const totalDamage = p.totalDamage ?? pMatches.reduce((s, m) => s + (Number(m.damage) || 0), 0);
    const kpm = matchesCount > 0 ? Math.round((totalKills / matchesCount) * 100) / 100 : 0;
    const avgDamage = matchesCount > 0 ? Math.round(totalDamage / matchesCount) : 0;
    const avgAcc = p.avgAccuracy ?? (p.accuracyCount > 0 ? Math.round((p.totalAccuracy / p.accuracyCount) * 10) / 10 : 0);

    const dmgShare = teamTotalDamage > 0 ? Math.round((totalDamage / teamTotalDamage) * 1000) / 10 : 0;
    const killShare = teamTotalKills > 0 ? Math.round((totalKills / teamTotalKills) * 1000) / 10 : 0;
    const dpk = totalKills > 0 ? Math.round((totalDamage / totalKills) * 10) / 10 : null;

    return {
      playerId: p.playerId,
      playerName: p.playerName || p.ign,
      ign: p.ign || p.playerName,
      slot: p.slot || 0,
      matchesCount,
      totalKills,
      kpm,
      peakKills,
      peakKillsMatch,
      totalDamage,
      avgDamage,
      peakDamage,
      peakDamageMatch,
      avgAccuracy: avgAcc,
      peakAccuracy,
      peakAccuracyMatch,
      damageShare: dmgShare,
      killShare,
      damagePerKill: dpk,
      analyticsRank: p.analyticsRank,
      rating: p.scores?.FINAL_RATING || p.scores?.RATING * 10 || 0,
      identity: p.identity || 'Balanced',
    };
  });

  // Sort roster by Total Kills descending (or MVP rating)
  roster.sort((a, b) => {
    if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
    return b.avgDamage - a.avgDamage;
  });

  // Squad Leaders
  const squadMVP = [...roster].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0] || null;
  const squadTopFragger = [...roster].sort((a, b) => b.totalKills - a.totalKills)[0] || null;
  const squadDamageLeader = [...roster].filter(r => r.matchesCount > 0).sort((a, b) => b.avgDamage - a.avgDamage)[0] || null;
  const squadAccuracyLeader = [...roster].filter(r => r.avgAccuracy > 0).sort((a, b) => b.avgAccuracy - a.avgAccuracy)[0] || null;
  const squadPeakDamage = [...roster].filter(r => r.peakDamage > 0).sort((a, b) => b.peakDamage - a.peakDamage)[0] || null;
  const squadPeakKills = [...roster].filter(r => r.peakKills > 0).sort((a, b) => b.peakKills - a.peakKills)[0] || null;

  return {
    roster,
    squadLeaders: {
      mvp: squadMVP,
      topFragger: squadTopFragger,
      damageLeader: squadDamageLeader,
      accuracyLeader: squadAccuracyLeader,
      peakDamage: squadPeakDamage ? {
        value: squadPeakDamage.peakDamage,
        player: squadPeakDamage.ign || squadPeakDamage.playerName,
        matchRef: squadPeakDamage.peakDamageMatch,
      } : null,
      peakKills: squadPeakKills ? {
        value: squadPeakKills.peakKills,
        player: squadPeakKills.ign || squadPeakKills.playerName,
        matchRef: squadPeakKills.peakKillsMatch,
      } : null,
    },
    teamTotals: {
      kills: teamTotalKills,
      damage: Math.round(teamTotalDamage),
      matches: roster.reduce((max, p) => Math.max(max, p.matchesCount), 0),
    },
  };
}
