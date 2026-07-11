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

// ─── GET handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!checkApiAuth(request)) return corsJson({ error: 'unauthorized' }, 401);

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get('tournamentId');
  const day = parseInt(searchParams.get('day') || '0');
  const lobby = searchParams.get('lobby') ? parseInt(searchParams.get('lobby')) : null;
  const n = parseInt(searchParams.get('n') || '5');

  if (!tournamentId || !day) {
    return corsJson({ error: 'tournamentId and day are required' }, 400);
  }

  const tournament = await getTournament(tournamentId);
  if (!tournament) return corsJson({ error: 'tournament not found' }, 404);

  // Get all team match results for this tournament
  const allResults = await getTeamMatchResults(tournamentId);
  const bonusPoints = await getBonusPoints(tournamentId);
  const teamRegs = await getTeamRegistrations(tournamentId);
  const allTeams = await getTeams();
  const globalTeamMap = Object.fromEntries(allTeams.map((t) => [t.id, t]));

  // Filter to the requested day + optional lobby
  const scopedResults = allResults.filter(r => {
    const dayMatch = r.day === day;
    const lobbyMatch = lobby !== null ? r.lobby === lobby : true;
    return dayMatch && lobbyMatch;
  });

  const { placementPoints = [], killPointValue = 2 } = tournament.scoring || {};

  // Build per-team stats from scoped results only
  const teamMap = {};
  for (const r of scopedResults) {
    if (!teamMap[r.teamId]) {
      const reg = teamRegs.find(t => t.teamId === r.teamId);
      const globalTeam = globalTeamMap[r.teamId];
      teamMap[r.teamId] = {
        teamId: r.teamId,
        teamName: r.teamName || reg?.teamName || globalTeam?.teamName || r.teamId,
        clanName: reg?.clanName || globalTeam?.clanName || '',
        logoUrl: reg?.logoUrl || globalTeam?.logoUrl || globalTeam?.logo || null,
        wins: 0,
        matches: 0,
        placementPts: 0,
        kills: 0,
        totalPts: 0,
        top3Finishes: 0,
        top5Finishes: 0,
        lobbiesPlayed: [],
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
    if (r.placement <= 3) t.top3Finishes++;
    if (r.placement <= 5) t.top5Finishes++;
    t.lobbiesPlayed.push({ lobby: r.lobby, placement: r.placement, kills: r.kills });
  }

  // Add bonus points scoped to this day
  const scopedBonuses = bonusPoints.filter(b => b.day === day && (lobby === null || b.lobby === lobby));
  for (const b of scopedBonuses) {
    if (teamMap[b.teamId]) {
      teamMap[b.teamId].totalPts += b.amount || 0;
    }
  }

  // Sort by totalPts desc (tiebreak: placementPts, then kills)
  const ranked = Object.values(teamMap)
    .sort((a, b) => {
      if (b.totalPts !== a.totalPts) return b.totalPts - a.totalPts;
      if (b.placementPts !== a.placementPts) return b.placementPts - a.placementPts;
      return b.kills - a.kills;
    })
    .map((t, i) => ({ ...t, rank: i + 1 }));

  return corsJson({
    tournamentId,
    day,
    lobby: lobby ?? 'all',
    scope: lobby !== null ? `Day ${day} — Lobby ${lobby}` : `Day ${day} — All Lobbies`,
    n,
    results: ranked.slice(0, n),
  });
}
