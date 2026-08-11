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
import { getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { cleanTeamName } from '@/lib/utils/similarity';

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

    const targetCleanName = cleanTeamName(teamDoc.teamName || teamDoc.name || '').toLowerCase();

    // Filter results for team, day, and lobby (matching teamId, teamDoc.id, or clean teamName)
    const filteredResults = allPlayerResults.filter((r) => {
      const matchTeam =
        r.teamId === teamId ||
        r.teamId === teamDoc.id ||
        (r.teamName && cleanTeamName(r.teamName).toLowerCase() === targetCleanName);
      if (!matchTeam) return false;
      return Number(r.day) === day && Number(r.lobby) === lobby;
    });

    // Group & sum kills by playerId
    const playerKillsMap = {};
    let totalLobbyKills = 0;
    filteredResults.forEach((res) => {
      const kills = Number(res.kills) || 0;
      totalLobbyKills += kills;
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
          countryEmoji: getCountryEmoji(country),
          kills: playerKillsMap[p.id] || 0,
          photoUrl: p.photoUrl || null,
        };
      });

    // Sort descending by kills
    playersList.sort((a, b) => b.kills - a.kills);

    const existingPlayerIds = new Set(playersList.map((p) => p.id));

    // Fallback: If we have fewer than 4 players, check playerRegistrations for this tournament
    const playerRegs = await getPlayerRegistrations(tournamentId).catch(() => []);
    const teamRegs = playerRegs.filter((reg) => {
      return (
        reg.teamId === teamId ||
        reg.teamId === teamDoc.id ||
        (reg.teamName && cleanTeamName(reg.teamName).toLowerCase() === targetCleanName)
      );
    });

    const missingPids = teamRegs
      .map((r) => r.playerId)
      .filter((pid) => pid && !existingPlayerIds.has(pid));

    if (missingPids.length > 0) {
      const regPlayerDocs = await Promise.all(missingPids.map((pid) => getPlayer(pid)));
      regPlayerDocs.filter(Boolean).forEach((p) => {
        if (!existingPlayerIds.has(p.id)) {
          existingPlayerIds.add(p.id);
          playersList.push({
            id: p.id,
            ign: p.ign || '—',
            professionalName: p.professionalName || p.ign || 'Unknown Player',
            country: p.country || null,
            countryEmoji: getCountryEmoji(p.country),
            kills: 0,
            photoUrl: p.photoUrl || null,
          });
        }
      });
    }

    const top4Players = playersList.slice(0, 4);

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

    while (top4Players.length < 4) {
      top4Players.push({ ...EMPTY_SLOT });
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
        totalKills: totalLobbyKills,
      },
      players: top4Players,
    };

    return corsJson(responseData, 200);
  } catch (err) {
    console.error('[overlay/lobby-kills] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
