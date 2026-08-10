import { NextResponse } from 'next/server';
import {
  getTournaments,
  setTournamentRanked,
  getTeamRegistrations,
  getPlayerRegistrations,
} from '@/lib/firestore/tournaments';
import { updateTeam, updatePlayer } from '@/lib/firestore/registry';

// ─── Tier dominance helper ────────────────────────────────────────────────────
// Given a list of tier strings, pick the most frequent one.
// On ties, the more prestigious tier (lower number) wins.
function computeDominantTier(tierList) {
  if (!tierList || tierList.length === 0) return null;
  const counts = {};
  for (const t of tierList) {
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  // Sort by count desc, then by tier number asc on ties (lower = more prestigious)
  const sorted = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff !== 0) return countDiff;
    const numA = parseInt(a.replace('Tier ', '')) || 99;
    const numB = parseInt(b.replace('Tier ', '')) || 99;
    return numA - numB;
  });
  return sorted[0] || null;
}

// ─── POST /api/rankEvent ──────────────────────────────────────────────────────
// Body: { tournamentId: string, isRanked: boolean, tier: 'Tier 1'|'Tier 2'|'Tier 3' }
export async function POST(request) {
  try {
    const body = await request.json();
    const { tournamentId, isRanked, tier } = body;

    if (!tournamentId) {
      return NextResponse.json({ error: 'tournamentId is required' }, { status: 400 });
    }
    if (isRanked && !['Tier 1', 'Tier 2', 'Tier 3'].includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier. Must be Tier 1, Tier 2, or Tier 3.' }, { status: 400 });
    }

    // 1. Update the tournament doc
    await setTournamentRanked(tournamentId, isRanked, tier);

    // 2. Fetch ALL tournaments to recompute dominant tiers globally
    const allTournaments = await getTournaments();

    // Build map: tournamentId → rankedTier (only for ranked tournaments)
    const rankedTourMap = {};
    for (const t of allTournaments) {
      // Use freshly-written value for the current tournament
      if (t.id === tournamentId) {
        if (isRanked) rankedTourMap[t.id] = tier;
      } else if (t.isRanked && t.rankedTier) {
        rankedTourMap[t.id] = t.rankedTier;
      }
    }

    // 3. Accumulate team tiers across all ranked tournaments
    const teamTierAccumulator = {};
    for (const [tourId, tierLabel] of Object.entries(rankedTourMap)) {
      const regs = await getTeamRegistrations(tourId);
      for (const reg of regs) {
        if (!reg.teamId) continue;
        if (!teamTierAccumulator[reg.teamId]) teamTierAccumulator[reg.teamId] = [];
        teamTierAccumulator[reg.teamId].push(tierLabel);
      }
    }

    // Ensure teams from now-unranked tournament are also processed (so they lose their tier if no other ranked events)
    if (!isRanked) {
      const thisTeamRegs = await getTeamRegistrations(tournamentId);
      for (const reg of thisTeamRegs) {
        if (reg.teamId && !teamTierAccumulator[reg.teamId]) {
          teamTierAccumulator[reg.teamId] = [];
        }
      }
    }

    // 4. Update each affected team
    const teamUpdatePromises = Object.entries(teamTierAccumulator).map(([teamId, tiers]) => {
      const dominant = computeDominantTier(tiers);
      return updateTeam(teamId, {
        rankedTier: dominant,
        rankedEventsCount: tiers.length,
      });
    });
    await Promise.all(teamUpdatePromises);

    // 5. Accumulate player tiers across all ranked tournaments
    const playerTierAccumulator = {};
    for (const [tourId, tierLabel] of Object.entries(rankedTourMap)) {
      const regs = await getPlayerRegistrations(tourId);
      for (const reg of regs) {
        if (!reg.playerId) continue;
        if (!playerTierAccumulator[reg.playerId]) playerTierAccumulator[reg.playerId] = [];
        playerTierAccumulator[reg.playerId].push(tierLabel);
      }
    }

    // Ensure players from now-unranked tournament are also processed
    if (!isRanked) {
      const thisPlayerRegs = await getPlayerRegistrations(tournamentId);
      for (const reg of thisPlayerRegs) {
        if (reg.playerId && !playerTierAccumulator[reg.playerId]) {
          playerTierAccumulator[reg.playerId] = [];
        }
      }
    }

    // 6. Update each affected player
    const playerUpdatePromises = Object.entries(playerTierAccumulator).map(([playerId, tiers]) => {
      const dominant = computeDominantTier(tiers);
      return updatePlayer(playerId, {
        rankedTier: dominant,
        rankedEventsCount: tiers.length,
      });
    });
    await Promise.all(playerUpdatePromises);

    return NextResponse.json({
      success: true,
      tournamentId,
      isRanked,
      tier: isRanked ? tier : null,
      teamsUpdated: Object.keys(teamTierAccumulator).length,
      playersUpdated: Object.keys(playerTierAccumulator).length,
    });

  } catch (err) {
    console.error('[rankEvent] Error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
