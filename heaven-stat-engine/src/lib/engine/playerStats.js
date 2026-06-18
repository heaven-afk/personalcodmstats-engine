/**
 * playerStats.js
 * Computes all player stat views from raw player match results + registrations.
 * Supports Set 1, Set 2, Combined, and Details views.
 */

// ─── Per-tournament player stats ──────────────────────────────────────────────
export function computePlayerStats(playerMatchResults, playerRegistrations, tournamentConfig) {
  const { playerClasses = [], totalDays = 6, lobbiesPerDay = 4 } = tournamentConfig?.structure || {};

  // Build registration lookup
  const regByPlayerId = {};
  for (const reg of playerRegistrations) {
    regByPlayerId[reg.playerId] = reg;
  }

  const playerMap = {};

  for (const result of playerMatchResults) {
    const key = result.playerId;
    const reg = regByPlayerId[key];

    // Check active day for this player's class
    if (reg) {
      const playerClass = playerClasses.find((c) => c.className === reg.class);
      if (playerClass && !playerClass.activeDays.includes(result.day)) {
        continue; // Skip inactive days
      }
    }

    if (!playerMap[key]) {
      playerMap[key] = {
        playerId: result.playerId,
        playerName: result.playerName || result.playerId,
        ign: reg?.ign || result.playerName || '',
        teamId: reg?.teamId || result.teamId || '',
        teamName: result.teamName || '',
        clanName: result.clanName || '',
        class: reg?.class || '',
        slot: reg?.slot || 0,
        gender: result.gender || '',
        region: result.region || '',
        country: result.country || '',
        device: result.device || '',
        deviceModel: result.deviceModel || '',
        totalKills: 0,
        totalDamage: 0,
        totalAccuracy: 0,
        accuracyCount: 0,
        totalMatches: 0,
        totalEvents: 0,
        perDay: {}, // day → { kills, damage, accuracy, matches, lobbies: [L1,L2,L3] }
        activeDays: new Set(),
      };
    }

    const p = playerMap[key];
    p.totalKills += result.kills || 0;
    p.totalDamage += result.damage || 0;
    if (result.accuracy != null && result.accuracy > 0) {
      p.totalAccuracy += result.accuracy;
      p.accuracyCount++;
    }
    p.totalMatches++;
    p.activeDays.add(result.day);

    if (!p.perDay[result.day]) {
      p.perDay[result.day] = { kills: 0, damage: 0, accuracy: 0, accuracyCount: 0, matches: 0, lobbies: {} };
    }
    p.perDay[result.day].kills += result.kills || 0;
    p.perDay[result.day].damage += result.damage || 0;
    if (result.accuracy != null && result.accuracy > 0) {
      p.perDay[result.day].accuracy += result.accuracy;
      p.perDay[result.day].accuracyCount++;
    }
    p.perDay[result.day].matches++;
    p.perDay[result.day].lobbies[result.lobby] = {
      kills: result.kills || 0,
      damage: result.damage || 0,
      accuracy: result.accuracy || 0,
    };
  }

  return Object.values(playerMap).map((p) => {
    const events = p.activeDays.size;
    const avgDamage = p.totalMatches > 0 ? Math.round(p.totalDamage / p.totalMatches) : 0;
    const avgAccuracy = p.accuracyCount > 0 ? Math.round((p.totalAccuracy / p.accuracyCount) * 100) / 100 : 0;
    const killsPerMatch = p.totalMatches > 0 ? Math.round((p.totalKills / p.totalMatches) * 100) / 100 : 0;
    const killsPerEvent = events > 0 ? Math.round((p.totalKills / events) * 100) / 100 : 0;

    // Per-day kill breakdown for D1–D6
    const perDayKills = {};
    for (let d = 1; d <= totalDays; d++) {
      perDayKills[`d${d}`] = p.perDay[d]?.kills ?? 0;
    }

    return {
      ...p,
      events,
      avgDamage,
      avgAccuracy,
      killsPerMatch,
      killsPerEvent,
      activeDays: [...p.activeDays].sort(),
      ...perDayKills,
    };
  });
}

// ─── Filter helpers for each standings tab ────────────────────────────────────
export function filterSet1Players(players) {
  return players.filter((p) => p.class && p.class.toLowerCase().includes('1'))
    .sort((a, b) => b.totalKills - a.totalKills);
}

export function filterSet2Players(players) {
  return players.filter((p) => p.class && p.class.toLowerCase().includes('2'))
    .sort((a, b) => b.totalKills - a.totalKills);
}

export function sortCombined(players) {
  return [...players].sort((a, b) => b.totalKills - a.totalKills);
}
