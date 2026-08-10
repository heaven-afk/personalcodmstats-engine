import {
  collection, doc, getDocs, updateDoc, writeBatch,
  query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase';
import {
  getTournaments,
  getTeamRegistrations,
  getPlayerRegistrations,
} from './tournaments';
import { updateTeam, updatePlayer } from './registry';

// ─── Tier dominance helper ────────────────────────────────────────────────────
// Given a list of tier strings, returns the most-frequent tier.
// On ties, the more prestigious tier (lower number) wins.
function computeDominantTier(tierList) {
  if (!tierList || tierList.length === 0) return null;
  const counts = {};
  for (const t of tierList) {
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  const sorted = Object.keys(counts).sort((a, b) => {
    const countDiff = counts[b] - counts[a];
    if (countDiff !== 0) return countDiff;
    const numA = parseInt(a.replace('Tier ', '')) || 99;
    const numB = parseInt(b.replace('Tier ', '')) || 99;
    return numA - numB;
  });
  return sorted[0] || null;
}

// ─── rankEvent ────────────────────────────────────────────────────────────────
// Client-side function — must be called from the browser where the user's
// Firebase Auth session is active (all writes require isSignedIn()).
//
// 1. Stamps isRanked / rankedTier / rankedAt on the tournament document.
// 2. Re-fetches ALL tournaments to rebuild the global ranked-event picture.
// 3. For every team and player that appears in any ranked tournament, recomputes
//    their dominant tier and writes it back to the registry.
//
// Returns: { teamsUpdated: number, playersUpdated: number }
export async function rankEvent(tournamentId, isRanked, tier) {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured. Cannot rank event in local mode.');
  }

  // 1. Update the tournament document
  const tourRef = doc(db, 'tournaments', tournamentId);
  await updateDoc(tourRef, {
    isRanked: !!isRanked,
    rankedTier: isRanked ? tier : null,
    rankedAt: isRanked ? serverTimestamp() : null,
  });

  // 2. Re-fetch all tournaments (so we have up-to-date isRanked flags)
  const allTournaments = await getTournaments();

  // Build map: tournamentId → rankedTier (only ranked events)
  // Use the freshly-written value for the current tournament
  const rankedTourMap = {};
  for (const t of allTournaments) {
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

  // Ensure teams from a now-unranked event are still evaluated (to clear their tier)
  if (!isRanked) {
    const thisRegs = await getTeamRegistrations(tournamentId);
    for (const reg of thisRegs) {
      if (reg.teamId && !teamTierAccumulator[reg.teamId]) {
        teamTierAccumulator[reg.teamId] = [];
      }
    }
  }

  // 4. Write each affected team's dominant tier
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

  // Ensure players from a now-unranked event are still evaluated (to clear their tier)
  if (!isRanked) {
    const thisRegs = await getPlayerRegistrations(tournamentId);
    for (const reg of thisRegs) {
      if (reg.playerId && !playerTierAccumulator[reg.playerId]) {
        playerTierAccumulator[reg.playerId] = [];
      }
    }
  }

  // 6. Write each affected player's dominant tier
  const playerUpdatePromises = Object.entries(playerTierAccumulator).map(([playerId, tiers]) => {
    const dominant = computeDominantTier(tiers);
    return updatePlayer(playerId, {
      rankedTier: dominant,
      rankedEventsCount: tiers.length,
    });
  });
  await Promise.all(playerUpdatePromises);

  return {
    teamsUpdated: Object.keys(teamTierAccumulator).length,
    playersUpdated: Object.keys(playerTierAccumulator).length,
  };
}
