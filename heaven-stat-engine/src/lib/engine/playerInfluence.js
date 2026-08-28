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
 *     teamSize,        // distinct players on team for this match
 *   }
 *
 * Solo matches (teamSize === 1) are always excluded.
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
  const valid = matches.filter(m => m[teamKey] > 0 && m.teamSize > 1);
  if (!valid.length) return null;
  const avgPct = valid.reduce((s, m) => s + (m[playerKey] / m[teamKey]), 0) / valid.length;
  const avgTeamSize = valid.reduce((s, m) => s + m.teamSize, 0) / valid.length;
  const baseline = 1 / avgTeamSize; // dynamic equal-share, NOT hardcoded 25%
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
 * computePlayerInfluence
 *
 * @param {string} playerId
 * @param {Array} teamMatchHistory  (see module header)
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
  // Filter to non-solo matches only
  const nonSolo = teamMatchHistory.filter(m => m.teamSize > 1);

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

  const MIN_SAMPLE = 3;
  const isProvisional =
    withMatches.length < MIN_SAMPLE || withoutMatches.length < MIN_SAMPLE;

  // A. Positional Finish score (lower placement = better; "without" minus "with" = uplift)
  const avgPlacementWith    = avg(withMatches, 'placement');
  const avgPlacementWithout = avg(withoutMatches, 'placement');
  const positionalScore =
    avgPlacementWith != null && avgPlacementWithout != null
      ? clamp(5 + (avgPlacementWithout - avgPlacementWith), 0, 10)
      : null;

  // B. Team Kills score
  const avgTeamKillsWith    = avg(withMatches, 'teamTotalKills');
  const avgTeamKillsWithout = avg(withoutMatches, 'teamTotalKills');
  const teamKillsScore =
    avgTeamKillsWith != null && avgTeamKillsWithout != null && avgTeamKillsWithout > 0
      ? clamp(
          5 + (((avgTeamKillsWith - avgTeamKillsWithout) / avgTeamKillsWithout) * 10),
          0,
          10
        )
      : null;

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
