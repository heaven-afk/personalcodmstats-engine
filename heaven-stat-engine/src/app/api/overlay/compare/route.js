/**
 * src/app/api/overlay/compare/route.js
 *
 * GET /api/overlay/compare?type={team|player}&a={idA}&b={idB}&tournamentId={optional}
 *
 * Head-to-head comparison between two teams or two players.
 *
 * Scoping:
 *   - If `tournamentId` is provided: stats are scoped to that single tournament
 *     using the per-tournament analytics computation.
 *   - If `tournamentId` is omitted: career-wide stats from the global aggregation
 *     are used (same data set as /api/overlay/rankings).
 *
 * Both `type=team` and `type=player` are supported with identical scoping logic.
 *
 * Authentication: every request must include the `x-overlay-api-key` header
 * with a value matching the OVERLAY_API_KEY environment variable on this server.
 * The Overlay Engine (overlay-engine repo) must set this same value in its env
 * and send it on every request to these endpoints.
 *
 * CORS: permissive headers are set on every response so the separately-deployed
 * Overlay Engine can call these endpoints cross-origin.
 */

import { NextResponse } from 'next/server';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { getTournament, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { computeTeamAnalytics } from '@/lib/engine/analytics';
import { computePlayerStats, computePlayerAnalytics } from '@/lib/engine/playerStats';
import { aggregateGlobalTeams, aggregateGlobalPlayers } from '@/lib/engine/globalAggregations';

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

function unauthorizedResponse() {
  return corsJson({ error: 'unauthorized' }, 401);
}

// ─── OPTIONS preflight (CORS) ─────────────────────────────────────────────────
export async function OPTIONS() {
  return corsJson(null, 204);
}

// ─── GET handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  if (!checkApiAuth(request)) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const type         = searchParams.get('type') || 'team';
  const a            = searchParams.get('a');
  const b            = searchParams.get('b');
  const tournamentId = searchParams.get('tournamentId') || null; // optional

  if (!a || !b) {
    return corsJson(
      { error: 'both a and b entity IDs are required' },
      400
    );
  }

  try {
    let entityA = null;
    let entityB = null;
    const scope = tournamentId ? 'tournament' : 'career';

    if (type === 'team') {
      if (tournamentId) {
        // ── Tournament-scoped: pull analytics for this tournament only ──────
        const tournament = await getTournament(tournamentId);
        if (!tournament) {
          return corsJson({ error: 'tournament not found' }, 404);
        }

        const [teamResults, bonusPoints] = await Promise.all([
          getTeamMatchResults(tournamentId),
          getBonusPoints(tournamentId),
        ]);

        const analytics = computeTeamAnalytics(
          teamResults,
          bonusPoints,
          tournament.scoring || {}
        );

        entityA = analytics.find((t) => t.teamId === a) || null;
        entityB = analytics.find((t) => t.teamId === b) || null;
      } else {
        // ── Career-wide: use global aggregation ──────────────────────────────
        const allTeams = await aggregateGlobalTeams();
        entityA = allTeams.find((t) => t.id === a) || null;
        entityB = allTeams.find((t) => t.id === b) || null;
      }

      return corsJson({ type, scope, tournamentId, teamA: entityA, teamB: entityB });

    } else {
      // ── type === 'player' ───────────────────────────────────────────────────
      if (tournamentId) {
        // Tournament-scoped player comparison
        const tournament = await getTournament(tournamentId);
        if (!tournament) {
          return corsJson({ error: 'tournament not found' }, 404);
        }

        const [playerResults, playerRegs, teamResults] = await Promise.all([
          getPlayerMatchResults(tournamentId),
          getPlayerRegistrations(tournamentId),
          getTeamMatchResults(tournamentId),
        ]);

        const playerStats = computePlayerStats(playerResults, playerRegs, tournament);
        const analytics   = computePlayerAnalytics(playerStats, teamResults);

        entityA = analytics.find((p) => p.playerId === a) || null;
        entityB = analytics.find((p) => p.playerId === b) || null;
      } else {
        // Career-wide player comparison
        const allPlayers = await aggregateGlobalPlayers();
        entityA = allPlayers.find((p) => p.id === a) || null;
        entityB = allPlayers.find((p) => p.id === b) || null;
      }

      return corsJson({ type, scope, tournamentId, playerA: entityA, playerB: entityB });
    }
  } catch (err) {
    console.error('[overlay/compare] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
