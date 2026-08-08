/**
 * src/app/api/overlay/match-summary/route.js
 *
 * GET /api/overlay/match-summary?tournamentId={id}&scope={lobby|match}&day={day}&lobby={lobby}&groupId={groupId}
 *
 * Returns summary stats for a single lobby or full match/tournament scope,
 * with logoUrl attached to every team reference in the response.
 */

import { NextResponse } from 'next/server';
import { getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { getTournament, getTeamRegistrations } from '@/lib/firestore/tournaments';
import { getPlacementPoints } from '@/lib/engine/scoring';
import { getTeams } from '@/lib/firestore/registry';

// ─── Auth & CORS helpers ──────────────────────────────────────────────────────
function checkApiAuth(request) {
  const provided = request.headers.get('x-overlay-api-key');
  const expected = process.env.OVERLAY_API_KEY;
  if (!expected) {
    throw new Error('OVERLAY_API_KEY is not configured on the server.');
  }
  return provided === expected;
}

function corsJson(data, status = 200) {
  const response = NextResponse.json(data, { status });
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'x-overlay-api-key, Content-Type');
  return response;
}

export async function OPTIONS() {
  return corsJson({}, 200);
}

export async function GET(request) {
  try {
    if (!checkApiAuth(request)) return corsJson({ error: 'unauthorized' }, 401);
  } catch (err) {
    return corsJson({ error: err.message }, 500);
  }

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get('tournamentId');
  const scope = searchParams.get('scope') || 'match'; // 'lobby' or 'match'
  const dayStr = searchParams.get('day');
  const lobbyStr = searchParams.get('lobby');
  const groupId = searchParams.get('groupId');

  if (!tournamentId) {
    return corsJson({ error: 'tournamentId is a required query parameter' }, 400);
  }

  const day = dayStr ? parseInt(dayStr, 10) : null;
  const lobby = lobbyStr ? parseInt(lobbyStr, 10) : null;

  try {
    const tournament = await getTournament(tournamentId);
    if (!tournament) return corsJson({ error: 'tournament not found' }, 404);

    const [allResults, bonusPoints, teamRegs, allTeams] = await Promise.all([
      getTeamMatchResults(tournamentId).catch(() => []),
      getBonusPoints(tournamentId).catch(() => []),
      getTeamRegistrations(tournamentId).catch(() => []),
      getTeams().catch(() => []),
    ]);

    // Build unified teamRegistry (teamId -> registry/team info)
    const teamRegistry = {};
    for (const reg of teamRegs) {
      if (reg.teamId) teamRegistry[reg.teamId] = reg;
    }
    for (const t of allTeams) {
      const id = t.id || t.teamId;
      if (id) {
        teamRegistry[id] = { ...t, ...(teamRegistry[id] || {}) };
      }
    }

    // Filter results by scope parameters
    let scopedResults = allResults;

    if (groupId && groupId !== 'all') {
      scopedResults = scopedResults.filter((r) => r.groupId === groupId);
    }

    if (scope === 'lobby') {
      if (day !== null) {
        scopedResults = scopedResults.filter((r) => r.day === day);
      }
      if (lobby !== null) {
        scopedResults = scopedResults.filter((r) => r.lobby === lobby);
      }
    } else if (scope === 'match') {
      if (day !== null) {
        scopedResults = scopedResults.filter((r) => r.day === day);
      }
    }

    const { placementPoints = [], killPointValue = 2 } = tournament.scoring || {};

    // Group stats by team
    const teamMap = {};

    for (const r of scopedResults) {
      if (!teamMap[r.teamId]) {
        const reg = teamRegistry[r.teamId];
        teamMap[r.teamId] = {
          teamId: r.teamId,
          teamName: r.teamName || reg?.teamName || reg?.name || r.teamId,
          clanName: reg?.clanName || '',
          wins: 0,
          matches: 0,
          placementPts: 0,
          kills: 0,
          totalPts: 0,
          placements: [],
        };
      }
      const t = teamMap[r.teamId];
      const ppts = getPlacementPoints(r.placement, placementPoints);
      const kpts = (r.kills || 0) * killPointValue;
      t.matches++;
      t.kills += r.kills || 0;
      t.placementPts += ppts;
      t.totalPts += ppts + kpts;
      if (r.placement === 1) t.wins++;
      t.placements.push(r.placement);
    }

    // Include bonus points
    const scopedBonuses = bonusPoints.filter((b) => {
      if (groupId && groupId !== 'all' && b.groupId && b.groupId !== groupId) return false;
      if (scope === 'lobby' && lobby !== null && b.lobby !== lobby) return false;
      if (day !== null && b.day !== day) return false;
      return true;
    });

    for (const b of scopedBonuses) {
      if (teamMap[b.teamId]) {
        teamMap[b.teamId].totalPts += b.amount || 0;
      }
    }

    // Rank teams by totalPts desc, placementPts desc, kills desc
    const scopedStandings = Object.values(teamMap)
      .map((t) => {
        const avgPlacement = t.placements.length > 0
          ? t.placements.reduce((sum, val) => sum + val, 0) / t.placements.length
          : 0;
        return {
          ...t,
          avgPlacement: Math.round(avgPlacement * 10) / 10,
        };
      })
      .sort((a, b) => {
        if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
        if (b.placementPts !== a.placementPts) return b.placementPts - a.placementPts;
        return b.kills - a.kills;
      })
      .map((t, index) => ({ ...t, rank: index + 1 }));

    let winner = scopedStandings[0] || null;

    let placementLeader = null;
    if (scopedStandings.length > 0) {
      placementLeader = [...scopedStandings].sort((a, b) => {
        if (a.avgPlacement !== b.avgPlacement) return a.avgPlacement - b.avgPlacement; // lower is better
        return b.placementPts - a.placementPts;
      })[0] || null;
    }

    let killLeader = null;
    if (scopedStandings.length > 0) {
      killLeader = [...scopedStandings].sort((a, b) => b.kills - a.kills)[0] || null;
    }

    const top3 = scopedStandings.slice(0, 3);

    // Biggest mover calculation (if match history available)
    let biggestMover = null;
    const movers = scopedStandings.map((t) => {
      const reg = teamRegistry[t.teamId];
      const initialRank = reg?.seed || reg?.rank || t.rank;
      const placesGained = initialRank - t.rank;
      return { ...t, placesGained };
    }).filter((t) => t.placesGained > 0);

    if (movers.length > 0) {
      movers.sort((a, b) => b.placesGained - a.placesGained);
      biggestMover = movers[0];
    }

    // Underdog candidate: registered in bottom 50% or seed > 10 that finished in top 3
    let underdogCandidate = null;
    for (const t of top3) {
      const reg = teamRegistry[t.teamId];
      const seed = reg?.seed || reg?.rank || 0;
      if (seed >= 8 || reg?.isUnderdog) {
        underdogCandidate = { ...t, rankCategory: 'Low Rank' };
        break;
      }
    }

    // Attach logoUrl to every team-shaped object in the response
    function attachLogo(teamEntry) {
      if (!teamEntry) return teamEntry;
      const reg = teamRegistry[teamEntry.teamId];
      return {
        ...teamEntry,
        logoUrl: reg?.logoUrl || reg?.logo || teamEntry.logoUrl || null,
      };
    }

    winner = attachLogo(winner);
    placementLeader = attachLogo(placementLeader);
    killLeader = attachLogo(killLeader);
    const top3WithLogos = top3.map(attachLogo);
    if (biggestMover) biggestMover = attachLogo(biggestMover);
    if (underdogCandidate) underdogCandidate = attachLogo(underdogCandidate);

    return corsJson({
      tournamentId,
      scope,
      day: day ?? null,
      lobby: lobby ?? null,
      winner,
      placementLeader,
      killLeader,
      top3: top3WithLogos,
      biggestMover,
      underdogCandidate,
      results: scopedStandings.map(attachLogo),
    });
  } catch (err) {
    console.error('[overlay/match-summary] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
