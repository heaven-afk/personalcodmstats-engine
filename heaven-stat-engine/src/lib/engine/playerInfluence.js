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
  return arr.reduce((s, m) => s + (m[key] || 0), 0) / arr.length;
}

function computeContribution(matches, playerKey, teamKey) {
  const valid = matches.filter(m => m[teamKey] > 0 && (m.teamSize > 1 || !m.isSolo));
  if (!valid.length) return null;
  const avgPct = valid.reduce((s, m) => s + (m[playerKey] / m[teamKey]), 0) / valid.length;
  const avgTeamSize = valid.reduce((s, m) => s + (m.teamSize > 1 ? m.teamSize : 4), 0) / valid.length;
  const baseline = 1 / avgTeamSize; // dynamic equal-share (e.g. 25% for 4-man squad)
  return {
    percent: round1(avgPct * 100),
    baselinePercent: round1(baseline * 100),
    score: clamp(5 * (avgPct / baseline), 0, 10),
  };
}

function influenceLabel(score) {
  if (score < 3) return 'Low Influence';
  if (score < 6) return 'Moderate Influence';
  if (score < 8) return 'High Influence';
  return 'Elite Influence';
}

/**
 * buildTeamMatchHistoryEntries
 *
 * Shared helper that assembles the teamMatchHistory array for a single player
 * within a single tournament. Used by both the career-wide analysis page
 * (called once per tournament, accumulated) and computeTournamentPlayerInfluence
 * (called once, scoped to the one tournament).
 *
 * Mirrors the two-block assembly logic from players/[id]/analysis/page.jsx:
 *   Block A — team-driven matches (teamMatchResults filtered to myTeamId)
 *   Block B — player-only fallback matches missing from teamResults
 *
 * @param {object}  tournament         - Tournament document (format, isSolo, playersPerTeam, id)
 * @param {string}  playerId           - The player whose influence we're computing
 * @param {Array}   teamMatchResults   - Raw team match result rows for this tournament
 * @param {Array}   playerMatchResults - Raw player match result rows for this tournament
 * @returns {Array} teamMatchHistory entries
 */
export function buildTeamMatchHistoryEntries(tournament, playerId, teamMatchResults, playerMatchResults) {
  if (!tournament || !playerId) return [];

  const t = tournament;
  const playerResults = playerMatchResults || [];
  const teamResults   = teamMatchResults   || [];

  // Resolve this player's teamId
  const myTeamId = playerResults.find(pr => pr.playerId === playerId)?.teamId;
  if (!myTeamId) return [];

  const isSoloTourney = t.format === 'solo' || t.isSolo === true;

  // Distinct teammates across the whole tournament (used as teamSize fallback)
  const distinctTeammatesInTourney = new Set(
    playerResults.filter(pr => pr.teamId === myTeamId).map(pr => pr.playerId)
  ).size;

  const teamMatchesForMyTeam = teamResults.filter(tr => tr.teamId === myTeamId);
  const processedMatchKeys = new Set();
  const entries = [];

  // ── Block A: team-driven matches ─────────────────────────────────────────────
  teamMatchesForMyTeam.forEach(tm => {
    const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;
    processedMatchKeys.add(matchKey);

    // All player results in the same match for this team
    const allPlayerResultsThisMatch = playerResults.filter(pr =>
      pr.teamId === myTeamId &&
      pr.day === tm.day &&
      pr.lobby === tm.lobby &&
      (tm.groupId ? pr.groupId === tm.groupId : true)
    );

    const distinctPlayersThisMatch = new Set(allPlayerResultsThisMatch.map(pr => pr.playerId)).size;
    const teamSize = isSoloTourney
      ? 1
      : (distinctPlayersThisMatch > 1
          ? distinctPlayersThisMatch
          : (distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : (t.playersPerTeam || 4)));

    const myResult = allPlayerResultsThisMatch.find(pr => pr.playerId === playerId);
    const present = Boolean(myResult);

    // Team total damage: sum of all player damages, or estimated from team kills
    let teamTotalDamage = allPlayerResultsThisMatch.reduce((s, pr) => s + (pr.damage || 0), 0);
    if (myResult?.damage && teamTotalDamage <= myResult.damage && (tm.kills || 0) > (myResult?.kills || 0)) {
      teamTotalDamage = myResult.kills > 0
        ? Math.round((myResult.damage / myResult.kills) * (tm.kills || 1))
        : myResult.damage + ((tm.kills || 1) * 250);
    }

    entries.push({
      matchId: `${t.id}-${matchKey}`,
      teamId: myTeamId,
      present,
      placement: tm.placement || 0,
      teamTotalKills: tm.kills || myResult?.kills || 0,
      playerKills: myResult?.kills || 0,
      playerDamage: myResult?.damage || 0,
      teamTotalDamage,
      teamSize,
      isSolo: isSoloTourney,
    });
  });

  // ── Block B: player-only fallback (matches missing from teamResults) ──────────
  const myPlayerResults = playerResults.filter(pr => pr.playerId === playerId);
  myPlayerResults.forEach(pr => {
    const matchKey = `${pr.day}-${pr.lobby}${pr.groupId ? '-' + pr.groupId : ''}`;
    if (processedMatchKeys.has(matchKey)) return;
    processedMatchKeys.add(matchKey);

    const allPlayerResultsThisMatch = playerResults.filter(r =>
      r.teamId === myTeamId &&
      r.day === pr.day &&
      r.lobby === pr.lobby &&
      (pr.groupId ? r.groupId === pr.groupId : true)
    );

    const distinctPlayersThisMatch = new Set(allPlayerResultsThisMatch.map(r => r.playerId)).size;
    const teamSize = isSoloTourney
      ? 1
      : (distinctPlayersThisMatch > 1
          ? distinctPlayersThisMatch
          : (distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : (t.playersPerTeam || 4)));

    const teamTotalKills  = allPlayerResultsThisMatch.reduce((s, r) => s + (r.kills || 0), 0);
    const teamTotalDamage = allPlayerResultsThisMatch.reduce((s, r) => s + (r.damage || 0), 0);

    entries.push({
      matchId: `${t.id}-${matchKey}`,
      teamId: myTeamId,
      present: true,
      placement: pr.placement || 0,
      teamTotalKills: teamTotalKills || pr.kills || 0,
      playerKills: pr.kills || 0,
      playerDamage: pr.damage || 0,
      teamTotalDamage: teamTotalDamage || pr.damage || 0,
      teamSize,
      isSolo: isSoloTourney,
    });
  });

  return entries;
}

/**
 * computeTournamentPlayerInfluence
 *
 * Computes a tournament-scoped Player Influence score (0–10) for MVP blending.
 * Only looks at matches within the given tournament — independent of the player's
 * career-wide influence score used on the /players/[id]/analysis page.
 *
 * Falls back gracefully: returns { influenceScore: null } when there is
 * insufficient match data (e.g. solo-only tournament, player with no results).
 *
 * @param {string} playerId
 * @param {object} tournament          - Tournament document
 * @param {Array}  teamMatchResults    - Raw team match result rows (this tournament only)
 * @param {Array}  playerMatchResults  - Raw player match result rows (this tournament only)
 * @returns {{ influenceScore: number|null }}
 */
export function computeTournamentPlayerInfluence(playerId, tournament, teamMatchResults, playerMatchResults) {
  if (!playerId || !tournament) return { influenceScore: null };

  const teamMatchHistory = buildTeamMatchHistoryEntries(
    tournament, playerId, teamMatchResults, playerMatchResults
  );

  if (!teamMatchHistory.length) return { influenceScore: null };

  // Only "present" non-solo matches contribute to the kill-share contribution score
  const presentMatches = teamMatchHistory.filter(m => m.present && !m.isSolo);
  const contribution = computeContribution(presentMatches, 'playerKills', 'teamTotalKills');

  return {
    influenceScore: contribution?.score ?? null,
    killsContribution: contribution ?? null, // { percent, baselinePercent, score }
  };
}

/**
 * computePlayerInfluence
 *
 * @param {string} playerId
 * @param {Array} teamMatchHistory
 * @returns {{\
 *   influenceScore: number|null,
 *   label: string|null,
 *   eligible: boolean,
 *   isProvisional: boolean,
 *   sampleSize: { with: number, without: number },
 *   breakdown: {\
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
      teamSize: m.teamSize > 1 ? m.teamSize : 4,
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
  if (avgPlacementWith != null && avgPlacementWithout != null) {
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
  if (avgTeamKillsWith != null && avgTeamKillsWithout != null && avgTeamKillsWithout > 0) {
    teamKillsScore = clamp(
      5 + (((avgTeamKillsWith - avgTeamKillsWithout) / avgTeamKillsWithout) * 10),
      0,
      10
    );
  } else if (avgTeamKillsWith != null && avgTeamKillsWith > 0) {
    // Standalone firepower score (e.g. 10+ team kills = ~8.0)
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
    : null;

  return {
    influenceScore,
    label: influenceScore == null ? null : influenceLabel(influenceScore),
    eligible: true,
    isProvisional,
    sampleSize: { with: withMatches.length, without: withoutMatches.length },
    breakdown: { positionalScore, teamKillsScore, killsContribution, damageContribution },
  };
}
