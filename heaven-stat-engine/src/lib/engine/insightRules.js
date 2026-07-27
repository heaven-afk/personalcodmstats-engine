/**
 * insightRules.js
 * Rule-based fact detection engine (Layer 1).
 * Reads pre-computed analytics and outputs structured fact objects.
 * Pure arithmetic — deterministic, zero AI cost, zero hallucination risk.
 */

export function computePercentile(val, allVals) {
  if (!allVals || allVals.length === 0) return 0;
  const lowerCount = allVals.filter(v => v < val).length;
  return Math.round((lowerCount / allVals.length) * 100);
}

export function formatPercentileBand(pct) {
  if (pct >= 95) return 'Top 5%';
  if (pct >= 90) return 'Top 10%';
  if (pct >= 80) return 'Top 20%';
  if (pct >= 75) return 'Top 25%';
  if (pct >= 65) return 'Top 35%';
  if (pct >= 50) return 'Top 50%';
  return 'Bottom 50%';
}

/**
 * Detect team facts for tournament/career performance
 */
export function detectTeamInsights(team, tournamentField = [], careerHistory = []) {
  if (!team || !team.analytics || !team.scores) return [];
  const insights = [];

  const name = team.teamName || team.teamId || 'Team';

  // 1. Momentum insight
  const fMI = team.analytics.forwardMI || 0;
  if (fMI > 1.15) {
    insights.push({
      type: 'momentum_positive',
      strength: 'high',
      data: { name, improvementPct: Math.round((fMI - 1) * 100), forwardMI: fMI },
    });
  } else if (fMI < 0.85 && fMI > 0) {
    insights.push({
      type: 'momentum_negative',
      strength: 'high',
      data: { name, declinePct: Math.round((1 - fMI) * 100), forwardMI: fMI },
    });
  }

  // 2. Driver analysis: placement vs power
  const placementScore = team.scores.PLACEMENT || 0;
  const powerScore = team.scores.POWER || 0;
  if (placementScore > powerScore + 15) {
    insights.push({
      type: 'placement_driven',
      data: { name, placementScore, powerScore },
    });
  } else if (powerScore > placementScore + 15) {
    insights.push({
      type: 'power_driven',
      data: { name, placementScore, powerScore },
    });
  }

  // 3. Consistency insight
  const consistencyScore = team.normalization?.consistencyScore ?? 50;
  if (consistencyScore > 80) {
    insights.push({
      type: 'highly_consistent',
      data: { name, consistencyScore },
    });
  } else if (consistencyScore < 30) {
    insights.push({
      type: 'inconsistent',
      data: { name, consistencyScore },
    });
  }

  // 4. Career-best flag
  if (careerHistory && careerHistory.length > 0) {
    const priorRatings = careerHistory
      .filter(h => h.tournamentId !== team.tournamentId)
      .map(h => h.rating || h.score || 0);
    if (priorRatings.length > 0) {
      const bestPriorRating = Math.max(...priorRatings);
      if ((team.scores.FINAL_RATING || 0) > bestPriorRating) {
        insights.push({
          type: 'career_best',
          data: { name, previousBest: bestPriorRating, newRating: team.scores.FINAL_RATING },
        });
      }
    }
  }

  // 5. Percentile standouts within field
  if (tournamentField && tournamentField.length > 1) {
    const allPPM = tournamentField.map(t => t.analytics?.PPM || 0);
    const ppmPct = computePercentile(team.analytics.PPM || 0, allPPM);
    if (ppmPct >= 90) {
      insights.push({
        type: 'elite_scoring',
        data: { name, percentile: ppmPct, band: formatPercentileBand(ppmPct), ppm: team.analytics.PPM },
      });
    }

    const allWinRates = tournamentField.map(t => t.analytics?.winRate || 0);
    const winPct = computePercentile(team.analytics.winRate || 0, allWinRates);
    if (winPct >= 85) {
      insights.push({
        type: 'clutch_finishers',
        data: { name, percentile: winPct, band: formatPercentileBand(winPct), winRate: team.analytics.winRate },
      });
    }
  }

  return insights;
}

/**
 * Detect player facts for tournament/career performance
 */
export function detectPlayerInsights(player, tournamentField = [], careerHistory = []) {
  if (!player || !player.analytics || !player.scores) return [];
  const insights = [];

  const name = player.ign || player.playerName || player.playerId || 'Player';

  // 1. Momentum
  const fMI = player.analytics.forwardMI || 0;
  if (fMI > 1.15) {
    insights.push({
      type: 'player_momentum_positive',
      strength: 'high',
      data: { name, improvementPct: Math.round((fMI - 1) * 100), forwardMI: fMI },
    });
  } else if (fMI < 0.85 && fMI > 0) {
    insights.push({
      type: 'player_momentum_negative',
      strength: 'high',
      data: { name, declinePct: Math.round((1 - fMI) * 100), forwardMI: fMI },
    });
  }

  // 2. Driver analysis
  const powerScore = player.scores.POWER || 0;
  const placementScore = player.scores.PLACEMENT ?? 50;
  if (powerScore > placementScore + 15) {
    insights.push({
      type: 'player_slayer_driven',
      data: { name, powerScore, kpm: player.analytics.KPM, dpm: player.analytics.DPM },
    });
  }

  // 3. Consistency
  const consistencyScore = player.normalization?.consistencyScore ?? 50;
  if (consistencyScore > 80) {
    insights.push({
      type: 'player_consistent',
      data: { name, consistencyScore },
    });
  } else if (consistencyScore < 30) {
    insights.push({
      type: 'player_inconsistent',
      data: { name, consistencyScore },
    });
  }

  // 4. Career-best flag
  if (careerHistory && careerHistory.length > 0) {
    const priorRatings = careerHistory
      .filter(h => h.tournamentId !== player.tournamentId)
      .map(h => h.rating || h.score || 0);
    if (priorRatings.length > 0) {
      const bestPriorRating = Math.max(...priorRatings);
      if ((player.scores.FINAL_RATING || player.scores.RATING || 0) > bestPriorRating) {
        insights.push({
          type: 'player_career_best',
          data: { name, previousBest: bestPriorRating, newRating: player.scores.FINAL_RATING || player.scores.RATING },
        });
      }
    }
  }

  // 5. Percentile standouts within field
  if (tournamentField && tournamentField.length > 1) {
    const allKPM = tournamentField.map(p => p.analytics?.KPM || 0);
    const kpmPct = computePercentile(player.analytics.KPM || 0, allKPM);
    if (kpmPct >= 90) {
      insights.push({
        type: 'player_elite_kpm',
        data: { name, percentile: kpmPct, band: formatPercentileBand(kpmPct), kpm: player.analytics.KPM },
      });
    }

    const allDPM = tournamentField.map(p => p.analytics?.DPM || 0);
    const dpmPct = computePercentile(player.analytics.DPM || 0, allDPM);
    if (dpmPct >= 90) {
      insights.push({
        type: 'player_elite_dpm',
        data: { name, percentile: dpmPct, band: formatPercentileBand(dpmPct), dpm: player.analytics.DPM },
      });
    }
  }

  return insights;
}

/**
 * Fallback template phrasing generator when Gemini API is unconfigured or fails
 */
export function generateDeterministicTemplate(insights, entityName = 'The team') {
  if (!insights || insights.length === 0) {
    return `${entityName} demonstrated solid performance across match lobbies.`;
  }

  const sentences = [];

  for (const fact of insights) {
    const d = fact.data || {};
    switch (fact.type) {
      case 'momentum_positive':
      case 'player_momentum_positive':
        sentences.push(`${d.name || entityName} surged in the second half with a ${d.improvementPct}% improvement in scoring pace.`);
        break;
      case 'momentum_negative':
      case 'player_momentum_negative':
        sentences.push(`${d.name || entityName} saw a ${d.declinePct}% drop in output during second-half lobbies.`);
        break;
      case 'placement_driven':
        sentences.push(`${d.name || entityName}'s performance was driven primarily by high placement efficiency (Placement Score: ${d.placementScore}).`);
        break;
      case 'power_driven':
        sentences.push(`${d.name || entityName} relied heavily on raw firepower and kill power (Power Score: ${d.powerScore}).`);
        break;
      case 'highly_consistent':
      case 'player_consistent':
        sentences.push(`${d.name || entityName} maintained impressive lobby-to-lobby stability (Consistency Score: ${d.consistencyScore}).`);
        break;
      case 'inconsistent':
      case 'player_inconsistent':
        sentences.push(`${d.name || entityName} experienced volatile scoring swings across different match lobbies.`);
        break;
      case 'career_best':
      case 'player_career_best':
        sentences.push(`${d.name || entityName} posted a career-best rating of ${d.newRating} this event.`);
        break;
      case 'elite_scoring':
        sentences.push(`${d.name || entityName} ranked in the ${d.band} field-wide with ${d.ppm} points per match.`);
        break;
      case 'clutch_finishers':
        sentences.push(`${d.name || entityName} ranked in the ${d.band} in overall win rate at ${d.winRate}%.`);
        break;
      case 'player_slayer_driven':
        sentences.push(`${d.name || entityName} anchored team combat with a high Power Score of ${d.powerScore} (${d.kpm} KPM / ${d.dpm} DPM).`);
        break;
      case 'player_elite_kpm':
        sentences.push(`${d.name || entityName} delivered elite fragging in the ${d.band} field-wide with ${d.kpm} kills per match.`);
        break;
      case 'player_elite_dpm':
        sentences.push(`${d.name || entityName} generated top-tier pressure in the ${d.band} field-wide with ${d.dpm} damage per match.`);
        break;
      default:
        break;
    }
  }

  if (sentences.length === 0) {
    return `${entityName} delivered a steady campaign.`;
  }

  // Cap at 3 natural sentences
  return sentences.slice(0, 3).join(' ');
}
