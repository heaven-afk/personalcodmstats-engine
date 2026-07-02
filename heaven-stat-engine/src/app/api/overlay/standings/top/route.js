/**
 * src/app/api/overlay/standings/top/route.js
 *
 * GET /api/overlay/standings/top?tournamentId={id}&n={count}&type={team|player}
 *
 * Returns the top N teams or players for a given tournament, using the same
 * analytics computations as the main engine. The `n` and `type` parameters
 * are flexible — no separate endpoint per count or per type is needed.
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

// ─── Auth & CORS helpers (shared pattern across all overlay routes) ───────────

/**
 * Check the shared-secret API key.
 * Returns true if the request is authorised, false otherwise.
 */
function checkApiAuth(request) {
  const provided = request.headers.get('x-overlay-api-key');
  const expected = process.env.OVERLAY_API_KEY;
  if (!expected) {
    throw new Error('OVERLAY_API_KEY is not configured on the server.');
  }
  return provided === expected;
}

/**
 * Return a CORS-enabled JSON response.
 * @param {unknown} data     - The response body (will be JSON-serialised)
 * @param {number}  [status] - HTTP status code (default 200)
 */
function corsJson(data, status = 200) {
  const response = NextResponse.json(data, { status });
  // Allow the Overlay Engine (separate origin) to call these endpoints.
  // Restrict to the Overlay Engine's deployed origin if/when that is known.
  response.headers.set('Access-Control-Allow-Origin', '*');
  response.headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'x-overlay-api-key, Content-Type');
  return response;
}

/** Shorthand for a 401 Unauthorized response with CORS headers. */
function unauthorizedResponse() {
  return corsJson({ error: 'unauthorized' }, 401);
}

// ─── OPTIONS preflight (CORS) ─────────────────────────────────────────────────
export async function OPTIONS() {
  return corsJson(null, 204);
}

// ─── GET handler ──────────────────────────────────────────────────────────────
export async function GET(request) {
  // Auth check — reject unauthenticated requests immediately
  if (!checkApiAuth(request)) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const tournamentId = searchParams.get('tournamentId');
  const n = parseInt(searchParams.get('n') || '5', 10);
  const type = searchParams.get('type') || 'team';

  if (!tournamentId) {
    return corsJson({ error: 'tournamentId is required' }, 400);
  }

  let tournament;
  try {
    tournament = await getTournament(tournamentId);
  } catch (err) {
    console.error('[overlay/standings/top] Firestore error:', err);
    return corsJson({ error: 'failed to fetch tournament' }, 500);
  }

  if (!tournament) {
    return corsJson({ error: 'tournament not found' }, 404);
  }

  try {
    if (type === 'team') {
      const [teamResults, bonusPoints] = await Promise.all([
        getTeamMatchResults(tournamentId),
        getBonusPoints(tournamentId),
      ]);
      // computeTeamAnalytics returns teams sorted by totalPts (with tiebreakers)
      // and attaches analyticsRank — reuse that ordering directly.
      const analytics = computeTeamAnalytics(teamResults, bonusPoints, tournament.scoring || {});
      return corsJson({ tournamentId, type, n, results: analytics.slice(0, n) });
    } else {
      // type === 'player'
      const [playerResults, playerRegs, teamResults] = await Promise.all([
        getPlayerMatchResults(tournamentId),
        getPlayerRegistrations(tournamentId),
        getTeamMatchResults(tournamentId), // needed for placement inheritance in computePlayerAnalytics
      ]);
      const playerStats = computePlayerStats(playerResults, playerRegs, tournament);
      // computePlayerAnalytics returns players sorted by RATING descending with analyticsRank.
      const analytics = computePlayerAnalytics(playerStats, teamResults);
      return corsJson({ tournamentId, type, n, results: analytics.slice(0, n) });
    }
  } catch (err) {
    console.error('[overlay/standings/top] Computation error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
