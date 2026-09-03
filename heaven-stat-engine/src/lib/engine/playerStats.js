/**
 * playerStats.js
 * Computes all player stat views from raw player match results + registrations.
 * Supports Set 1, Set 2, Combined, and Details views.
 */

// ─── Per-tournament player stats ──────────────────────────────────────────────
export function computePlayerStats(playerMatchResults, playerRegistrations = [], tournamentConfig = {}, teamMatchResults = []) {
  const { playerClasses = [], totalDays = 6, lobbiesPerDay = 4 } = tournamentConfig?.structure || {};

  // Build registration lookup by playerId, id, ign, and professionalName
  const regByPlayerId = {};
  const regByIgn = {};
  const regByName = {};

  for (const reg of playerRegistrations) {
    if (!reg) continue;
    if (reg.playerId) regByPlayerId[String(reg.playerId).trim()] = reg;
    if (reg.id) regByPlayerId[String(reg.id).trim()] = reg;
    if (reg.ign) regByIgn[String(reg.ign).trim().toLowerCase()] = reg;
    if (reg.professionalName) regByName[String(reg.professionalName).trim().toLowerCase()] = reg;
    if (reg.playerName) regByName[String(reg.playerName).trim().toLowerCase()] = reg;
  }

  // Pre-calculate team total kills from teamMatchResults if available
  const teamTotalKillsMap = {};
  for (const tr of (teamMatchResults || [])) {
    if (tr?.teamId) {
      teamTotalKillsMap[tr.teamId] = (teamTotalKillsMap[tr.teamId] || 0) + (Number(tr.kills) || 0);
    }
  }

  // Fallback player-derived team kills
  const playerDerivedTeamKillsMap = {};
  for (const result of (playerMatchResults || [])) {
    if (!result) continue;
    const key = result.playerId || result.playerName || result.ign;
    const reg = (result.playerId && regByPlayerId[String(result.playerId).trim()]) ||
      (regByPlayerId[String(key).trim()]) ||
      (result.ign && regByIgn[String(result.ign).trim().toLowerCase()]) ||
      (result.playerName && regByName[String(result.playerName).trim().toLowerCase()]) ||
      null;
    const tId = reg?.teamId || result.teamId;
    if (tId) {
      playerDerivedTeamKillsMap[tId] = (playerDerivedTeamKillsMap[tId] || 0) + (Number(result.kills) || 0);
    }
  }

  const playerMap = {};

  for (const result of (playerMatchResults || [])) {
    if (!result) continue;
    const key = result.playerId || result.playerName || result.ign;
    if (!key) continue;

    const reg = (result.playerId && regByPlayerId[String(result.playerId).trim()]) ||
      (regByPlayerId[String(key).trim()]) ||
      (result.ign && regByIgn[String(result.ign).trim().toLowerCase()]) ||
      (result.playerName && regByName[String(result.playerName).trim().toLowerCase()]) ||
      null;

    // Check active day for this player's class
    if (reg) {
      const playerClass = playerClasses.find((c) => c.className === reg.class);
      if (playerClass && !playerClass.activeDays.includes(result.day)) {
        continue; // Skip inactive days
      }
    }

    if (!playerMap[key]) {
      playerMap[key] = {
        playerId: result.playerId || reg?.playerId || reg?.id || key,
        playerName: reg?.professionalName || result.playerName || reg?.playerName || result.playerId || '',
        ign: reg?.ign || result.ign || result.playerName || '',
        teamId: reg?.teamId || result.teamId || '',
        teamName: reg?.teamName || result.teamName || '',
        clanName: reg?.clanName || result.clanName || '',
        class: reg?.class || result.class || '',
        slot: reg?.slot || result.slot || 0,
        gender: reg?.gender || result.gender || '',
        region: reg?.region || result.region || '',
        country: reg?.country || result.country || '',
        device: reg?.device || result.device || '',
        deviceModel: reg?.deviceModel || reg?.model || result.deviceModel || result.model || '',
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

    // Fallback backfill if fields became available
    if (!p.gender && (reg?.gender || result.gender)) p.gender = reg?.gender || result.gender;
    if (!p.region && (reg?.region || result.region)) p.region = reg?.region || result.region;
    if (!p.country && (reg?.country || result.country)) p.country = reg?.country || result.country;
    if (!p.device && (reg?.device || result.device)) p.device = reg?.device || result.device;
    if (!p.deviceModel && (reg?.deviceModel || reg?.model || result.deviceModel)) p.deviceModel = reg?.deviceModel || reg?.model || result.deviceModel;
    if (!p.clanName && (reg?.clanName || result.clanName)) p.clanName = reg?.clanName || result.clanName;
    if (!p.ign && (reg?.ign || result.ign)) p.ign = reg?.ign || result.ign;
    if (!p.class && (reg?.class || result.class)) p.class = reg?.class || result.class;

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

    const teamTotalKills = teamTotalKillsMap[p.teamId] !== undefined
      ? teamTotalKillsMap[p.teamId]
      : (playerDerivedTeamKillsMap[p.teamId] || 0);
    const killShare = teamTotalKills > 0 ? Math.round((p.totalKills / teamTotalKills) * 1000) / 10 : 0;

    // Per-day kill breakdown for active days only
    const perDayKills = {};
    for (const d of p.activeDays) {
      perDayKills[`d${d}`] = p.perDay[d]?.kills ?? 0;
    }

    return {
      ...p,
      events,
      avgDamage,
      avgAccuracy,
      killsPerMatch,
      killsPerEvent,
      teamTotalKills,
      killShare,
      killSharePct: killShare,
      activeDays: [...p.activeDays].sort(),
      ...perDayKills,
    };
  });
}

// ─── Daily Player Standings ──────────────────────────────────────────────────
export function computeDailyPlayerStandings(
  playerMatchResults = [],
  playerRegistrations = [],
  tournamentConfig = {},
  day = 1,
  teamMatchResults = []
) {
  const { playerClasses = [] } = tournamentConfig?.structure || {};

  const regByPlayerId = {};
  const regByIgn = {};
  const regByName = {};

  for (const reg of playerRegistrations) {
    if (!reg) continue;
    if (reg.playerId) regByPlayerId[String(reg.playerId).trim()] = reg;
    if (reg.id) regByPlayerId[String(reg.id).trim()] = reg;
    if (reg.ign) regByIgn[String(reg.ign).trim().toLowerCase()] = reg;
    if (reg.professionalName) regByName[String(reg.professionalName).trim().toLowerCase()] = reg;
    if (reg.playerName) regByName[String(reg.playerName).trim().toLowerCase()] = reg;
  }

  // Calculate team total kills on this specific day from teamMatchResults
  const teamDayKills = {};
  for (const tr of (teamMatchResults || [])) {
    if (Number(tr.day) === Number(day) && tr.teamId) {
      teamDayKills[tr.teamId] = (teamDayKills[tr.teamId] || 0) + (Number(tr.kills) || 0);
    }
  }

  // Filter player matches for the specific day
  const dayResults = (playerMatchResults || []).filter(r => Number(r.day) === Number(day));

  // Fallback: calculate team kills by aggregating player kills on this day
  const playerDerivedTeamKills = {};
  for (const r of dayResults) {
    const key = r.playerId || r.playerName || r.ign;
    const reg = (r.playerId && regByPlayerId[String(r.playerId).trim()]) ||
      (regByPlayerId[String(key).trim()]) ||
      (r.ign && regByIgn[String(r.ign).trim().toLowerCase()]) ||
      (r.playerName && regByName[String(r.playerName).trim().toLowerCase()]) ||
      null;
    const tId = reg?.teamId || r.teamId;
    if (tId) {
      playerDerivedTeamKills[tId] = (playerDerivedTeamKills[tId] || 0) + (Number(r.kills) || 0);
    }
  }

  const playerMap = {};

  for (const result of dayResults) {
    if (!result) continue;
    const key = result.playerId || result.playerName || result.ign;
    if (!key) continue;

    const reg = (result.playerId && regByPlayerId[String(result.playerId).trim()]) ||
      (regByPlayerId[String(key).trim()]) ||
      (result.ign && regByIgn[String(result.ign).trim().toLowerCase()]) ||
      (result.playerName && regByName[String(result.playerName).trim().toLowerCase()]) ||
      null;

    // Check active day for this player's class if defined
    if (reg) {
      const playerClass = playerClasses.find((c) => c.className === reg.class);
      if (playerClass && playerClass.activeDays && !playerClass.activeDays.includes(Number(day))) {
        continue; // Skip inactive days
      }
    }

    if (!playerMap[key]) {
      const tId = reg?.teamId || result.teamId || '';
      playerMap[key] = {
        playerId: result.playerId || reg?.playerId || reg?.id || key,
        playerName: reg?.professionalName || result.playerName || reg?.playerName || result.playerId || '',
        ign: reg?.ign || result.ign || result.playerName || '',
        teamId: tId,
        teamName: reg?.teamName || result.teamName || '',
        clanName: reg?.clanName || result.clanName || '',
        class: reg?.class || result.class || '',
        slot: reg?.slot || result.slot || 0,
        day: Number(day),
        totalKills: 0,
        totalDamage: 0,
        totalAccuracy: 0,
        accuracyCount: 0,
        matches: 0,
        lobbies: {},
      };
    }

    const p = playerMap[key];
    const k = Number(result.kills) || 0;
    const d = Number(result.damage) || 0;
    const acc = result.accuracy != null && Number(result.accuracy) > 0 ? Number(result.accuracy) : null;

    p.totalKills += k;
    p.totalDamage += d;
    if (acc !== null) {
      p.totalAccuracy += acc;
      p.accuracyCount++;
    }
    p.matches++;
    p.lobbies[result.lobby] = {
      kills: k,
      damage: d,
      accuracy: acc,
    };
  }

  const list = Object.values(playerMap).map(p => {
    const avgDamage = p.matches > 0 ? Math.round(p.totalDamage / p.matches) : 0;
    const avgAccuracy = p.accuracyCount > 0 ? Math.round((p.totalAccuracy / p.accuracyCount) * 10) / 10 : 0;
    const teamTotalKills = teamDayKills[p.teamId] !== undefined
      ? teamDayKills[p.teamId]
      : (playerDerivedTeamKills[p.teamId] || 0);

    const killShare = teamTotalKills > 0
      ? Math.round((p.totalKills / teamTotalKills) * 1000) / 10
      : 0;

    return {
      ...p,
      avgDamage,
      avgAccuracy,
      teamTotalKills,
      killShare,
      killSharePct: killShare,
    };
  });

  return list
    .sort((a, b) => {
      if (b.totalKills !== a.totalKills) return b.totalKills - a.totalKills;
      if (b.avgDamage !== a.avgDamage) return b.avgDamage - a.avgDamage;
      return b.avgAccuracy - a.avgAccuracy;
    })
    .map((p, idx) => ({
      ...p,
      rank: idx + 1,
    }));
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

// ─── Player Analytics Helper routines ──────────────────────────────────────────
function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

function round2(n) { return Math.round(n * 100) / 100; }

function normalize(val, minVal, maxVal) {
  if (maxVal === minVal) return 100;
  return Math.round(((val - minVal) / (maxVal - minVal)) * 100);
}

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

// ─── Player Analytics Computation ─────────────────────────────────────────────
export function computePlayerAnalytics(players, teamMatchResults) {
  if (!players || players.length === 0) return [];

  // Build placement lookup map: `${day}_${lobby}_${teamId}` -> placement
  const placementLookup = {};
  if (teamMatchResults && Array.isArray(teamMatchResults)) {
    for (const r of teamMatchResults) {
      const key = `${r.day}_${r.lobby}_${r.teamId}`;
      placementLookup[key] = r.placement;
    }
  }

  // Step 1: Calculate raw metrics for each player
  let enriched = players.map((p) => {
    // Power metrics
    const KPM = p.totalMatches > 0 ? round2(p.totalKills / p.totalMatches) : 0;
    const DPM = p.totalMatches > 0 ? round2(p.totalDamage / p.totalMatches) : 0;

    // Link placement data
    const playerPlacements = [];
    if (p.perDay && p.teamId) {
      for (const [dayStr, dayData] of Object.entries(p.perDay)) {
        const day = Number(dayStr);
        if (dayData && dayData.lobbies) {
          for (const lobbyStr of Object.keys(dayData.lobbies)) {
            const lobby = Number(lobbyStr);
            const key = `${day}_${lobby}_${p.teamId}`;
            const placement = placementLookup[key];
            if (placement !== undefined) {
              playerPlacements.push(placement);
            }
          }
        }
      }
    }

    const hasPlacementData = playerPlacements.length > 0;
    let avgPlacement = 0;
    let top3Finishes = 0;
    let top5Finishes = 0;
    let top3Rate = 0;
    let top5Rate = 0;
    let top3vs5Spread = 0;
    let wins = 0;
    let conversionRate = 0;
    let conversionRateTop3 = 0;
    let winRate = 0;

    if (hasPlacementData) {
      const matchesWithPlacement = playerPlacements.length;
      const sumPlacements = playerPlacements.reduce((sum, pl) => sum + pl, 0);
      avgPlacement = round2(sumPlacements / matchesWithPlacement);
      top3Finishes = playerPlacements.filter(pl => pl >= 1 && pl <= 3).length;
      top5Finishes = playerPlacements.filter(pl => pl >= 1 && pl <= 5).length;
      top3Rate = round2((top3Finishes / matchesWithPlacement) * 100);
      top5Rate = round2((top5Finishes / matchesWithPlacement) * 100);
      top3vs5Spread = round2(top5Rate - top3Rate);
      wins = playerPlacements.filter(pl => pl === 1).length;
      conversionRate = top5Finishes > 0 ? round2((wins / top5Finishes) * 100) : 0;
      conversionRateTop3 = top3Finishes > 0 ? round2((wins / top3Finishes) * 100) : 0;
      winRate = round2((wins / matchesWithPlacement) * 100);
    }

    // Form metrics
    const perDay = p.perDay || {};
    const activeDays = Object.keys(perDay).map(Number).sort((a, b) => a - b);
    const mid = Math.ceil(activeDays.length / 2);
    const firstHalfDays = activeDays.slice(0, mid);
    const secondHalfDays = activeDays.slice(mid);

    const firstHalfKills = firstHalfDays.reduce((sum, d) => sum + (perDay[d]?.kills || 0), 0);
    const secondHalfKills = secondHalfDays.reduce((sum, d) => sum + (perDay[d]?.kills || 0), 0);
    const firstHalfMatches = firstHalfDays.reduce((sum, d) => sum + (perDay[d]?.matches || 0), 0);
    const secondHalfMatches = secondHalfDays.reduce((sum, d) => sum + (perDay[d]?.matches || 0), 0);

    const firstHalfKPM = firstHalfMatches > 0 ? firstHalfKills / firstHalfMatches : 0;
    const secondHalfKPM = secondHalfMatches > 0 ? secondHalfKills / secondHalfMatches : 0;

    let forwardMI = 0;
    if (firstHalfKPM === 0) {
      forwardMI = secondHalfKPM > 0 ? 1 : 0;
    } else {
      forwardMI = round2(secondHalfKPM / firstHalfKPM);
    }

    const dKPM = activeDays.map((d) => {
      const pd = perDay[d];
      return pd && pd.matches > 0 ? round2(pd.kills / pd.matches) : 0;
    });
    const stdDevCS = round2(stdDev(dKPM));

    return {
      ...p,
      analytics: {
        KPM,
        DPM,
        avgPlacement,
        top3Rate,
        top5Rate,
        top3vs5Spread,
        conversionRate,
        conversionRateTop3,
        winRate,
        forwardMI,
        stdDevCS,
        hasPlacementData,
      },
      normalization: {},
      scores: {},
    };
  });

  // Step 2: Normalize metrics across all players
  const metricsToNormalize = [
    'KPM', 'DPM', 'winRate', 'conversionRate', 'conversionRateTop3', 'top5Rate', 'forwardMI'
  ];
  for (const metric of metricsToNormalize) {
    const values = enriched.map((p) => p.analytics[metric] ?? 0);
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    enriched = enriched.map((p) => ({
      ...p,
      normalization: {
        ...p.normalization,
        [`N_${metric}`]: normalize(p.analytics[metric] ?? 0, minVal, maxVal),
      },
    }));
  }

  // Normalize consistencyScore (lower standard deviation is more consistent)
  const stdDevs = enriched.map((p) => p.analytics.stdDevCS ?? 0);
  const minStdDev = Math.min(...stdDevs);
  const maxStdDev = Math.max(...stdDevs);
  enriched = enriched.map((p) => {
    const consistencyScore = maxStdDev === minStdDev
      ? 100
      : round2(((maxStdDev - p.analytics.stdDevCS) / (maxStdDev - minStdDev)) * 100);
    return {
      ...p,
      normalization: {
        ...p.normalization,
        consistencyScore,
      },
    };
  });

  // Normalize avgPlacement -> placeScore (among players who have placement data, lower is better)
  const playersWithPlacement = enriched.filter(p => p.analytics.hasPlacementData);
  const avgPlacements = playersWithPlacement.map(p => p.analytics.avgPlacement);
  const minAvgPlacement = avgPlacements.length > 0 ? Math.min(...avgPlacements) : 0;
  const maxAvgPlacement = avgPlacements.length > 0 ? Math.max(...avgPlacements) : 0;

  enriched = enriched.map((p) => {
    let placeScore = null;
    if (p.analytics.hasPlacementData) {
      placeScore = maxAvgPlacement === minAvgPlacement
        ? 100
        : round2(((maxAvgPlacement - p.analytics.avgPlacement) / (maxAvgPlacement - minAvgPlacement)) * 100);
    }
    return {
      ...p,
      normalization: {
        ...p.normalization,
        placeScore,
      },
    };
  });

  // Step 3: Component scores & Ratings
  enriched = enriched.map((p) => {
    const n = p.normalization;
    const POWER = Math.min(100, round2((n.N_KPM * 0.55) + (n.N_DPM * 0.45)));
    const PLACEMENT = p.analytics.hasPlacementData
      ? Math.min(100, round2((n.placeScore * 0.50) + (n.N_top5Rate * 0.50)))
      : null;
    const CONVERSION = Math.min(100, round2((n.N_winRate * 0.40) + (n.N_conversionRate * 0.40) + (n.N_conversionRateTop3 * 0.20)));
    const FORM = Math.min(100, round2((n.N_forwardMI * 0.55) + (n.consistencyScore * 0.45)));

    let RATING = 0;
    if (p.analytics.hasPlacementData) {
      RATING = round2((POWER * 0.35) + (PLACEMENT * 0.30) + (CONVERSION * 0.25) + (FORM * 0.10));
    } else {
      RATING = round2((POWER * 0.50) + (CONVERSION * 0.35) + (FORM * 0.15));
    }
    RATING = Math.min(100, RATING);
    const FINAL_RATING = Math.min(1000, round2(RATING * 10));

    return {
      ...p,
      scores: {
        POWER,
        PLACEMENT,
        CONVERSION,
        FORM,
        RATING,
        FINAL_RATING,
      },
      labels: {
        playstyle: playstyleLabel(POWER, PLACEMENT !== null ? PLACEMENT : 50, CONVERSION),
        powerLabel: powerLabel(POWER),
        placementLabel: PLACEMENT !== null ? placementLabel(PLACEMENT) : '—',
        conversionLabel: conversionLabel(CONVERSION),
        formLabel: formLabel(p.analytics.forwardMI, n.consistencyScore),
      },
    };
  });

  // Step 4: Identity Layer
  const avgPlayerRating = enriched.reduce((sum, p) => sum + p.scores.RATING, 0) / enriched.length;
  enriched = enriched.map((p) => {
    const { POWER, PLACEMENT, CONVERSION, FORM, RATING } = p.scores;
    let identity = 'Balanced';

    if (POWER >= 60 && PLACEMENT !== null && PLACEMENT >= 60 && CONVERSION >= 60 && FORM >= 60) {
      identity = 'Complete Player';
    } else if (RATING < avgPlayerRating && FORM >= 75) {
      identity = 'Dark Horse';
    } else if (FORM >= 80) {
      identity = 'Momentum Player';
    } else if (CONVERSION >= 80 && CONVERSION > POWER && (PLACEMENT === null || CONVERSION > PLACEMENT)) {
      identity = 'Closer';
    } else if (PLACEMENT !== null && PLACEMENT >= 75 && PLACEMENT > POWER) {
      identity = 'Survivalist';
    } else if (POWER >= 75 && (PLACEMENT === null || POWER > PLACEMENT)) {
      identity = 'Slayer';
    }

    return {
      ...p,
      identity,
    };
  });

  // Sort by RATING descending and assign rank
  return enriched
    .sort((a, b) => b.scores.RATING - a.scores.RATING)
    .map((p, i) => ({
      ...p,
      analyticsRank: i + 1,
    }));
}
