/**
 * src/app/api/overlay/team-kills/route.js
 *
 * GET /api/overlay/team-kills?tournamentId={id}&teamId={teamId}&scope={collation|daily}&day={day}
 *
 * Returns top 4 player kill totals for a team scoped to either full tournament collation or a single day.
 * Includes team branding, current tournament rank, and scope total kills.
 */

import { NextResponse } from 'next/server';
import { getPlayerMatchResults, getTeamMatchResults, getBonusPoints } from '@/lib/firestore/matchData';
import { getPlayer, getTeam } from '@/lib/firestore/registry';
import { getTournament } from '@/lib/firestore/tournaments';
import { computeSeasonStandings } from '@/lib/engine/standings';

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

function unauthorizedResponse() {
  return corsJson({ error: 'unauthorized' }, 401);
}

export async function OPTIONS() {
  return corsJson({}, 200);
}

export async function GET(request) {
  try {
    if (!checkApiAuth(request)) return unauthorizedResponse();
  } catch (err) {
    return corsJson({ error: err.message }, 500);
  }

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get('tournamentId');
  const teamId = searchParams.get('teamId');
  const scope = searchParams.get('scope') || 'collation';
  const dayStr = searchParams.get('day');

  if (!tournamentId || !teamId) {
    return corsJson({ error: 'tournamentId and teamId are required query parameters' }, 400);
  }

  let day = null;
  if (scope === 'daily') {
    if (!dayStr) {
      return corsJson({ error: 'day query parameter is required when scope is daily' }, 400);
    }
    day = parseInt(dayStr, 10);
    if (isNaN(day)) {
      return corsJson({ error: 'day must be an integer' }, 400);
    }
  }

  try {
    const [allPlayerResults, teamDoc, standingsData] = await Promise.all([
      getPlayerMatchResults(tournamentId),
      getTeam(teamId),
      calculateStandings(tournamentId).catch(() => ({ standings: [] })),
    ]);

    if (!teamDoc) {
      return corsJson({ error: 'team not found' }, 404);
    }

    // Filter results by team and scope
    const filteredResults = allPlayerResults.filter((r) => {
      if (r.teamId !== teamId) return false;
      if (scope === 'daily' && day !== null) {
        return r.day === day;
      }
      return true; // collation: all matches in tournament
    });

    // Group & sum kills by playerId
    const playerKillsMap = {};
    let totalScopeKills = 0;

    filteredResults.forEach((res) => {
      const kills = Number(res.kills) || 0;
      totalScopeKills += kills;
      if (res.playerId) {
        playerKillsMap[res.playerId] = (playerKillsMap[res.playerId] || 0) + kills;
      }
    });

    const playerIds = Object.keys(playerKillsMap);

    // Resolve player profile docs
    const playerDocs = await Promise.all(playerIds.map((pid) => getPlayer(pid)));

    const playersList = playerDocs
      .filter(Boolean)
      .map((p) => {
        const country = p.country || null;
        return {
          id: p.id,
          ign: p.ign || '—',
          professionalName: p.professionalName || p.ign || 'Unknown Player',
          country: country,
          kills: playerKillsMap[p.id] || 0,
          photoUrl: p.photoUrl || null,
        };
      });

    // Sort descending by kills
    playersList.sort((a, b) => b.kills - a.kills);

    // Take top 4 distinct players
    const top4Players = playersList.slice(0, 4);

    // Always pad to exactly 4 player slots
    const EMPTY_SLOT = {
      id: null,
      ign: '—',
      professionalName: 'Empty Slot',
      country: null,
      kills: 0,
      photoUrl: null,
    };

    while (top4Players.length < 4) {
      top4Players.push({ ...EMPTY_SLOT });
    }

    // Compute overall season standings to get absolute tournament rank
    const scoringConfig = tournamentDoc?.scoringConfig || {};
    const seasonStandings = computeSeasonStandings(teamMatchResults, bonusPoints, scoringConfig);
    const teamRankIdx = seasonStandings.findIndex((s) => (s.teamId || s.id) === teamId);
    const currentRank = teamRankIdx !== -1 ? teamRankIdx + 1 : (teamDoc.rank || 1);

    const responseData = {
      tournamentId,
      scope,
      ...(scope === 'daily' ? { day } : {}),
      team: {
        id: teamDoc.id,
        name: teamDoc.teamName || teamDoc.name || 'NOVA Esports',
        logo: teamDoc.logoUrl || teamDoc.logo || null,
        currentRank: currentRank,
        totalKills: totalScopeKills,
      },
      players: top4Players,
    };

    return corsJson(responseData, 200);
  } catch (err) {
    console.error('[overlay/team-kills] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
