/**
 * src/app/api/overlay/lobby-kills/route.js
 *
 * GET /api/overlay/lobby-kills?tournamentId={id}&day={day}&lobby={lobby}&teamId={teamId}
 *
 * Returns player-level kill totals for a single team in a single lobby,
 * along with team branding (logo, name, slot). Always returns exactly 4 player slots.
 */

import { NextResponse } from 'next/server';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getPlayer, getTeam } from '@/lib/firestore/registry';

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

function getCountryEmoji(countryCode) {
  if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) return '🏳️';
  const code = countryCode.toUpperCase();
  const FLAG_OFFSET = 127397;
  return String.fromCodePoint(...[...code].map((c) => c.charCodeAt(0) + FLAG_OFFSET));
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
  const dayStr = searchParams.get('day');
  const lobbyStr = searchParams.get('lobby');
  const teamId = searchParams.get('teamId');

  if (!tournamentId || !dayStr || !lobbyStr || !teamId) {
    return corsJson({ error: 'tournamentId, day, lobby, and teamId are required query parameters' }, 400);
  }

  const day = parseInt(dayStr, 10);
  const lobby = parseInt(lobbyStr, 10);

  if (isNaN(day) || isNaN(lobby)) {
    return corsJson({ error: 'day and lobby must be integers' }, 400);
  }

  try {
    const [allPlayerResults, teamDoc] = await Promise.all([
      getPlayerMatchResults(tournamentId),
      getTeam(teamId),
    ]);

    if (!teamDoc) {
      return corsJson({ error: 'team not found' }, 404);
    }

    // Filter results for team, day, and lobby
    const filteredResults = allPlayerResults.filter(
      (r) => r.teamId === teamId && r.day === day && r.lobby === lobby
    );

    // Group & sum kills by playerId
    const playerKillsMap = {};
    filteredResults.forEach((res) => {
      if (!res.playerId) return;
      playerKillsMap[res.playerId] = (playerKillsMap[res.playerId] || 0) + (res.kills || 0);
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
          professionalName: p.professionalName || 'Unknown Player',
          country: country,
          countryEmoji: getCountryEmoji(country),
          kills: playerKillsMap[p.id] || 0,
          photoUrl: p.photoUrl || null,
        };
      });

    // Sort descending by kills
    playersList.sort((a, b) => b.kills - a.kills);

    // Always pad to exactly 4 player slots
    const EMPTY_SLOT = {
      id: null,
      ign: '—',
      professionalName: 'Empty Slot',
      country: null,
      countryEmoji: '🏳️',
      kills: 0,
      photoUrl: null,
    };

    while (playersList.length < 4) {
      playersList.push({ ...EMPTY_SLOT });
    }

    const responseData = {
      tournamentId,
      day,
      lobby,
      team: {
        id: teamDoc.id,
        name: teamDoc.teamName || teamDoc.name || 'Team',
        logo: teamDoc.logoUrl || teamDoc.logo || null,
        slot: teamDoc.slot || null,
      },
      players: playersList.slice(0, 4),
    };

    return corsJson(responseData, 200);
  } catch (err) {
    console.error('[overlay/lobby-kills] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
