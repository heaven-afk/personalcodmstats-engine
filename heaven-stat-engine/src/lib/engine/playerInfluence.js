/**
 * playerInfluence.js
 *
 * Computes a Player Influence score (0–10) from duo/trio/squad match history.
 *
 * teamMatchHistory: Array of:
 *   {
 *     matchId,         // unique key (e.g. `${tournamentId}-${day}-${lobby}-${teamId}`)
 *     teamId,
 *     present: bool,   // true = player played this match
 *     placement,       // team finish position (lower = better)
 *     teamTotalKills,  // team kill count for that match
 *     playerKills,     // this player's kills (relevant when present)
 *     playerDamage,    // this player's damage (relevant when present)
 *     teamTotalDamage, // total team damage (may be estimated)
 *     teamSize,        // distinct players on team for this match (defaults to 4 for squad)
 *     isSolo: bool,    // explicitly solo event
 *   }
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function avg(arr, key) {
  if (!arr.length) return null;
  return arr.reduce((s, m) => s + (Number(m[key]) || 0), 0) / arr.length;
}

export function computeContribution(matches, playerKey, teamKey) {
  const valid = matches.filter(m => (Number(m[teamKey]) > 0 || Number(m[playerKey]) > 0) && !m.isSolo);
  if (!valid.length) return null;
  const avgPct = valid.reduce((s, m) => {
    const pVal = Number(m[playerKey]) || 0;
    const tVal = Math.max(Number(m[teamKey]) || 0, pVal);
    if (tVal <= 0) return s;
    return s + (pVal / tVal);
  }, 0) / valid.length;
  const avgTeamSize = valid.reduce((s, m) => s + (Number(m.teamSize) > 1 ? Number(m.teamSize) : 4), 0) / valid.length;
  const baseline = 1 / (avgTeamSize || 4); // dynamic equal-share (e.g. 25% for 4-man squad)
  return {
    percent: round1(avgPct * 100),
    baselinePercent: round1(baseline * 100),
    score: clamp(5 * (avgPct / baseline), 0, 10),
  };
}

export function influenceLabel(score) {
  if (score == null) return null;
  if (score < 3) return 'Low Influence';
  if (score < 6) return 'Moderate Influence';
  if (score < 8) return 'High Influence';
  return 'Elite Influence';
}

/**
 * buildTeamMatchHistoryEntries
 *
 * Shared helper that assembles the teamMatchHistory array for a single player
 * within a single tournament. Resilient across all entry methods (OCR, manual, smart-import):
 * - Resolves player identity by playerId, id, ign, or playerName
 * - Resolves team by teamId, teamName, or through playerRegistrations
 * - Correlates team match results and player match results
 * - Automatically falls back to player-derived team totals when team match results are absent
 * - Never falsely classifies a squad tournament as solo
 *
 * @param {object} tournament          - Tournament document
 * @param {string} playerId            - The player whose influence we're computing
 * @param {Array}  teamMatchResults    - Raw team match result rows for this tournament
 * @param {Array}  playerMatchResults  - Raw player match result rows for this tournament
 * @param {Array}  playerRegistrations - Player registration documents for this tournament
 * @returns {Array} teamMatchHistory entries
 */
export function buildTeamMatchHistoryEntries(
  tournament,
  playerId,
  teamMatchResults = [],
  playerMatchResults = [],
  playerRegistrations = []
) {
  if (!tournament || !playerId) return [];

  const t = tournament;
  const playerResults = playerMatchResults || [];
  const teamResults   = teamMatchResults   || [];
  const registrations = playerRegistrations || [];

  // 1. Build lookup dictionaries from registrations if available
  const regByPlayerId = {};
  const regByIgn = {};
  const regByName = {};

  for (const reg of registrations) {
    if (!reg) continue;
    if (reg.playerId) regByPlayerId[String(reg.playerId).trim()] = reg;
    if (reg.id) regByPlayerId[String(reg.id).trim()] = reg;
    if (reg.ign) regByIgn[String(reg.ign).trim().toLowerCase()] = reg;
    if (reg.professionalName) regByName[String(reg.professionalName).trim().toLowerCase()] = reg;
    if (reg.playerName) regByName[String(reg.playerName).trim().toLowerCase()] = reg;
  }

  const targetIdStr = String(playerId || '').trim();
  const targetIdLower = targetIdStr.toLowerCase();
  const playerReg = regByPlayerId[targetIdStr]
    || regByIgn[targetIdLower]
    || regByName[targetIdLower]
    || null;

  function matchesTargetPlayer(row) {
    if (!row) return false;
    const rPid = String(row.playerId || row.id || '').trim();
    if (rPid && (
      rPid === targetIdStr ||
      (playerReg?.playerId && rPid === String(playerReg.playerId).trim()) ||
      (playerReg?.id && rPid === String(playerReg.id).trim())
    )) {
      return true;
    }
    const rIgn = String(row.ign || '').trim().toLowerCase();
    if (rIgn && (
      rIgn === targetIdLower ||
      (playerReg?.ign && rIgn === String(playerReg.ign).trim().toLowerCase())
    )) {
      return true;
    }
    const rName = String(row.playerName || row.professionalName || '').trim().toLowerCase();
    if (rName && (
      rName === targetIdLower ||
      (playerReg?.professionalName && rName === String(playerReg.professionalName).trim().toLowerCase()) ||
      (playerReg?.playerName && rName === String(playerReg.playerName).trim().toLowerCase())
    )) {
      return true;
    }
    return false;
  }

  // 2. Find all player match results for this player
  const myPlayerResults = playerResults.filter(matchesTargetPlayer);

  // 3. Resolve target teamId and teamName
  let myTeamId = playerReg?.teamId || '';
  let myTeamName = playerReg?.teamName || '';

  if (!myTeamId) {
    const prWithTeamId = myPlayerResults.find(pr => pr.teamId);
    if (prWithTeamId) myTeamId = String(prWithTeamId.teamId).trim();
  }
  if (!myTeamName) {
    const prWithTeamName = myPlayerResults.find(pr => pr.teamName);
    if (prWithTeamName) myTeamName = String(prWithTeamName.teamName).trim();
  }

  // Fallback: check all player results if playerReg wasn't found
  if (!myTeamId && !myTeamName && myPlayerResults.length > 0) {
    myTeamId = String(myPlayerResults[0].teamId || myPlayerResults[0].teamName || '').trim();
    myTeamName = String(myPlayerResults[0].teamName || myPlayerResults[0].teamId || '').trim();
  }

  const normTeamId = myTeamId ? String(myTeamId).trim().toLowerCase() : null;
  const normTeamName = myTeamName ? String(myTeamName).trim().toLowerCase() : null;

  function matchesTeam(row) {
    if (!row) return false;
    const rTeamId = row.teamId ? String(row.teamId).trim().toLowerCase() : null;
    const rTeamName = row.teamName ? String(row.teamName).trim().toLowerCase() : null;

    if (normTeamId && rTeamId && rTeamId === normTeamId) return true;
    if (normTeamName && rTeamName && rTeamName === normTeamName) return true;
    if (normTeamId && rTeamName && rTeamName === normTeamId) return true;
    if (normTeamName && rTeamId && rTeamId === normTeamName) return true;

    // Check if row's player is registered to this team
    if (row.playerId) {
      const reg = regByPlayerId[String(row.playerId).trim()];
      if (reg) {
        const regTid = reg.teamId ? String(reg.teamId).trim().toLowerCase() : null;
        const regTname = reg.teamName ? String(reg.teamName).trim().toLowerCase() : null;
        if (normTeamId && regTid && regTid === normTeamId) return true;
        if (normTeamName && regTname && regTname === normTeamName) return true;
        if (normTeamId && regTname && regTname === normTeamId) return true;
        if (normTeamName && regTid && regTid === normTeamName) return true;
      }
    }
    return false;
  }

  // Explicit solo detection only (e.g. format: 'solo', isSolo: true).
  // Note: format: 'single' means single-stage and is NOT a solo tournament!
  const isSoloTourney = Boolean(
    t.isSolo === true ||
    t.format === 'solo' ||
    t.type === 'solo' ||
    t.mode === 'solo' ||
    (t.playersPerTeam === 1 && !t.structure?.playersPerTeam)
  );

  // Distinct teammates across the tournament
  const allTeammatesInTourney = new Set();
  playerResults.forEach(pr => {
    if (matchesTeam(pr)) {
      const pKey = pr.playerId || pr.playerName || pr.ign;
      if (pKey) allTeammatesInTourney.add(String(pKey).trim().toLowerCase());
    }
  });
  registrations.forEach(reg => {
    if (reg && matchesTeam(reg)) {
      const pKey = reg.playerId || reg.id || reg.playerName || reg.ign;
      if (pKey) allTeammatesInTourney.add(String(pKey).trim().toLowerCase());
    }
  });

  const distinctTeammatesInTourney = allTeammatesInTourney.size;
  const expectedSquadSize = Number(t.playersPerTeam || t.structure?.playersPerTeam || t.teamSize || 4) || 4;

  const teamMatchesForMyTeam = teamResults.filter(matchesTeam);
  const processedMatchKeys = new Set();
  const entries = [];

  // ── Block A: Team-driven matches ─────────────────────────────────────────────
  teamMatchesForMyTeam.forEach(tm => {
    const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;
    processedMatchKeys.add(matchKey);

    const allPlayerResultsThisMatch = playerResults.filter(pr =>
      matchesTeam(pr) &&
      Number(pr.day) === Number(tm.day) &&
      Number(pr.lobby) === Number(tm.lobby) &&
      (!tm.groupId || String(pr.groupId || '') === String(tm.groupId || ''))
    );

    const myResult = allPlayerResultsThisMatch.find(matchesTargetPlayer)
      || playerResults.find(pr =>
           matchesTargetPlayer(pr) &&
           Number(pr.day) === Number(tm.day) &&
           Number(pr.lobby) === Number(tm.lobby)
         )
      || null;

    const present = Boolean(myResult);
    const playerKills = Number(myResult?.kills) || 0;
    const playerDamage = Number(myResult?.damage) || 0;

    const teammatesKillsSum = allPlayerResultsThisMatch.reduce((sum, pr) => sum + (Number(pr.kills) || 0), 0);
    const tmKills = Number(tm.kills);
    const teamTotalKills = !isNaN(tmKills) && tmKills > 0
      ? Math.max(tmKills, teammatesKillsSum, playerKills)
      : Math.max(teammatesKillsSum, playerKills);

    const teammatesDamageSum = allPlayerResultsThisMatch.reduce((sum, pr) => sum + (Number(pr.damage) || 0), 0);
    let teamTotalDamage = (tm.damage != null && !isNaN(Number(tm.damage)) && Number(tm.damage) > 0)
      ? Number(tm.damage)
      : teammatesDamageSum;
    if (teamTotalDamage <= playerDamage && teamTotalKills > playerKills) {
      teamTotalDamage = playerKills > 0
        ? Math.round((playerDamage / playerKills) * teamTotalKills)
        : playerDamage + (teamTotalKills * 250);
    }
    if (!teamTotalDamage) teamTotalDamage = playerDamage;

    const distinctPlayersThisMatch = new Set(
      allPlayerResultsThisMatch.map(pr => pr.playerId || pr.playerName || pr.ign)
    ).size;

    const teamSize = isSoloTourney
      ? 1
      : Math.max(
          2,
          distinctPlayersThisMatch,
          distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : expectedSquadSize
        );

    entries.push({
      matchId: `${t.id || 't'}-${matchKey}`,
      teamId: myTeamId || myTeamName || 'team',
      present,
      placement: Number(tm.placement) || (myResult?.placement ? Number(myResult.placement) : 0),
      teamTotalKills,
      playerKills,
      playerDamage,
      teamTotalDamage,
      teamSize,
      isSolo: isSoloTourney,
      day: tm.day,
      lobby: tm.lobby,
      groupId: tm.groupId || null,
    });
  });

  // ── Block B: Player-only fallback matches ────────────────────────────────────
  myPlayerResults.forEach(pr => {
    const matchKey = `${pr.day}-${pr.lobby}${pr.groupId ? '-' + pr.groupId : ''}`;
    if (processedMatchKeys.has(matchKey)) return;
    processedMatchKeys.add(matchKey);

    const allPlayerResultsThisMatch = playerResults.filter(r =>
      matchesTeam(r) &&
      Number(r.day) === Number(pr.day) &&
      Number(r.lobby) === Number(pr.lobby) &&
      (!pr.groupId || String(r.groupId || '') === String(pr.groupId || ''))
    );

    const distinctPlayersThisMatch = new Set(
      allPlayerResultsThisMatch.map(r => r.playerId || r.playerName || r.ign)
    ).size;

    const teamSize = isSoloTourney
      ? 1
      : Math.max(
          2,
          distinctPlayersThisMatch,
          distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : expectedSquadSize
        );

    const playerKills = Number(pr.kills) || 0;
    const playerDamage = Number(pr.damage) || 0;
    const teammatesKillsSum = allPlayerResultsThisMatch.reduce((sum, r) => sum + (Number(r.kills) || 0), 0);
    const teamTotalKills = Math.max(teammatesKillsSum, playerKills);

    const teammatesDamageSum = allPlayerResultsThisMatch.reduce((sum, r) => sum + (Number(r.damage) || 0), 0);
    const teamTotalDamage = Math.max(teammatesDamageSum, playerDamage);

    entries.push({
      matchId: `${t.id || 't'}-${matchKey}`,
      teamId: myTeamId || myTeamName || 'team',
      present: true,
      placement: Number(pr.placement) || 0,
      teamTotalKills,
      playerKills,
      playerDamage,
      teamTotalDamage,
      teamSize,
      isSolo: isSoloTourney,
      day: pr.day,
      lobby: pr.lobby,
      groupId: pr.groupId || null,
    });
  });

  // ── Block C: Fallback if no team association could be resolved ───────────────
  if (!entries.length && myPlayerResults.length) {
    myPlayerResults.forEach(pr => {
      const matchKey = `${pr.day}-${pr.lobby}${pr.groupId ? '-' + pr.groupId : ''}`;
      if (processedMatchKeys.has(matchKey)) return;
      processedMatchKeys.add(matchKey);

      const playerKills = Number(pr.kills) || 0;
      const playerDamage = Number(pr.damage) || 0;
      entries.push({
        matchId: `${t.id || 't'}-${matchKey}`,
        teamId: 'team',
        present: true,
        placement: Number(pr.placement) || 0,
        teamTotalKills: playerKills,
        playerKills,
        playerDamage,
        teamTotalDamage: playerDamage,
        teamSize: isSoloTourney ? 1 : expectedSquadSize,
        isSolo: isSoloTourney,
        day: pr.day,
        lobby: pr.lobby,
        groupId: pr.groupId || null,
      });
    });
  }

  return entries;
}

/**
 * computeTournamentPlayerInfluence
 *
 * Computes a tournament-scoped Player Influence score (0–10).
 * Scoped to the given tournament — independent of career aggregates.
 *
 * @param {string} playerId
 * @param {object} tournament          - Tournament document
 * @param {Array}  teamMatchResults    - Raw team match result rows
 * @param {Array}  playerMatchResults  - Raw player match result rows
 * @param {Array}  playerRegistrations - Player registration documents
 * @returns {{
 *   influenceScore: number|null,
 *   label: string|null,
 *   eligible: boolean,
 *   killsContribution: { percent: number, baselinePercent: number, score: number }|null,
 *   breakdown: object|null,
 *   sampleSize: { with: number, without: number }
 * }}
 */
export function computeTournamentPlayerInfluence(
  playerId,
  tournament,
  teamMatchResults = [],
  playerMatchResults = [],
  playerRegistrations = []
) {
  if (!playerId || !tournament) {
    return {
      influenceScore: null,
      label: null,
      eligible: false,
      killsContribution: null,
      breakdown: null,
      sampleSize: { with: 0, without: 0 },
    };
  }

  const teamMatchHistory = buildTeamMatchHistoryEntries(
    tournament, playerId, teamMatchResults, playerMatchResults, playerRegistrations
  );

  if (!teamMatchHistory.length) {
    return {
      influenceScore: null,
      label: null,
      eligible: false,
      killsContribution: null,
      breakdown: null,
      sampleSize: { with: 0, without: 0 },
    };
  }

  const fullInfluence = computePlayerInfluence(playerId, teamMatchHistory);

  // Present non-solo matches for kills contribution
  const presentMatches = teamMatchHistory.filter(m => m.present && !m.isSolo);
  const killsContrib = computeContribution(presentMatches, 'playerKills', 'teamTotalKills')
    || fullInfluence.breakdown?.killsContribution
    || null;

  const influenceScore = fullInfluence.influenceScore != null
    ? fullInfluence.influenceScore
    : (killsContrib?.score != null ? killsContrib.score : null);

  const label = fullInfluence.label
    || (influenceScore != null ? influenceLabel(influenceScore) : null);

  return {
    influenceScore,
    label,
    eligible: influenceScore != null,
    killsContribution: killsContrib,
    breakdown: fullInfluence.breakdown || null,
    sampleSize: fullInfluence.sampleSize || { with: presentMatches.length, without: 0 },
  };
}

/**
 * computePlayerInfluence
 *
 * @param {string} playerId
 * @param {Array} teamMatchHistory
 * @returns {{
 *   influenceScore: number|null,
 *   label: string|null,
 *   eligible: boolean,
 *   isProvisional: boolean,
 *   sampleSize: { with: number, without: number },
 *   breakdown: {
 *     positionalScore: number|null,
 *     teamKillsScore: number|null,
 *     killsContribution: { percent, baselinePercent, score }|null,
 *     damageContribution: { percent, baselinePercent, score }|null,
 *   }
 * }}
 */
export function computePlayerInfluence(playerId, teamMatchHistory) {
  if (!teamMatchHistory || !teamMatchHistory.length) {
    return {
      influenceScore: null,
      label: null,
      eligible: false,
      isProvisional: false,
      sampleSize: { with: 0, without: 0 },
      breakdown: {
        positionalScore: null,
        teamKillsScore: null,
        killsContribution: null,
        damageContribution: null,
      },
    };
  }

  // Filter out explicit solo matches (if any) and normalize teamSize to at least 2 for team matches
  const nonSolo = teamMatchHistory
    .filter(m => !m.isSolo)
    .map(m => ({
      ...m,
      teamSize: Number(m.teamSize) > 1 ? Number(m.teamSize) : 4,
    }));

  if (!nonSolo.length) {
    return {
      influenceScore: null,
      label: null,
      eligible: false,
      isProvisional: false,
      sampleSize: { with: 0, without: 0 },
      breakdown: {
        positionalScore: null,
        teamKillsScore: null,
        killsContribution: null,
        damageContribution: null,
      },
    };
  }

  const withMatches    = nonSolo.filter(m => m.present);
  const withoutMatches = nonSolo.filter(m => !m.present);

  if (!withMatches.length) {
    return {
      influenceScore: null,
      label: null,
      eligible: false,
      isProvisional: false,
      sampleSize: { with: 0, without: withoutMatches.length },
      breakdown: {
        positionalScore: null,
        teamKillsScore: null,
        killsContribution: null,
        damageContribution: null,
      },
    };
  }

  const MIN_SAMPLE = 3;
  const isProvisional =
    withMatches.length < MIN_SAMPLE || withoutMatches.length < MIN_SAMPLE;

  // A. Positional Finish score
  const avgPlacementWith    = avg(withMatches, 'placement');
  const avgPlacementWithout = avg(withoutMatches, 'placement');
  let positionalScore = null;
  if (avgPlacementWith != null && avgPlacementWithout != null && withoutMatches.length > 0) {
    // Relative placement uplift when player plays
    positionalScore = clamp(5 + (avgPlacementWithout - avgPlacementWith), 0, 10);
  } else if (avgPlacementWith != null && avgPlacementWith > 0) {
    // Standalone positional score based on average placement finish (1st = 10, 5th = 6, 10th+ = 1)
    positionalScore = clamp(11 - avgPlacementWith, 1, 10);
  }

  // B. Team Kills score
  const avgTeamKillsWith    = avg(withMatches, 'teamTotalKills');
  const avgTeamKillsWithout = avg(withoutMatches, 'teamTotalKills');
  let teamKillsScore = null;
  if (avgTeamKillsWith != null && avgTeamKillsWithout != null && withoutMatches.length > 0 && avgTeamKillsWithout > 0) {
    teamKillsScore = clamp(
      5 + (((avgTeamKillsWith - avgTeamKillsWithout) / avgTeamKillsWithout) * 10),
      0,
      10
    );
  } else if (avgTeamKillsWith != null && avgTeamKillsWith > 0) {
    // Standalone firepower score (e.g. 10+ team kills = ~7.5)
    teamKillsScore = clamp(avgTeamKillsWith * 0.75, 1, 10);
  }

  // C. Kills Contribution (standalone metric, also feeds influence)
  const killsContribution = computeContribution(withMatches, 'playerKills', 'teamTotalKills');

  // D. Damage Contribution (standalone metric, also feeds influence)
  const damageContribution = computeContribution(withMatches, 'playerDamage', 'teamTotalDamage');

  const components = [
    positionalScore,
    teamKillsScore,
    killsContribution?.score,
    damageContribution?.score,
  ].filter(v => v != null);

  const influenceScore = components.length
    ? round1(components.reduce((s, v) => s + v, 0) / components.length)
    : (killsContribution?.score != null ? killsContribution.score : null);

  return {
    influenceScore,
    label: influenceScore == null ? null : influenceLabel(influenceScore),
    eligible: Boolean(influenceScore != null),
    isProvisional,
    sampleSize: { with: withMatches.length, without: withoutMatches.length },
    breakdown: { positionalScore, teamKillsScore, killsContribution, damageContribution },
  };
}
