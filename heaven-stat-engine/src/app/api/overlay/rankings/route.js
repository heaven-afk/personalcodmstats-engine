/**
 * src/app/api/overlay/rankings/route.js
 *
 * GET /api/overlay/rankings?type={team|player}&limit={count}
 *
 * Returns a globally-ranked list of all teams or players ordered by career
 * performance metrics. Aggregation logic is shared with comparison/page.jsx
 * via src/lib/engine/globalAggregations.js.
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
  const type  = searchParams.get('type') || 'team';
  const limit = parseInt(searchParams.get('limit') || '20', 10);

  try {
    let allEntities;
    let sorted;

    if (type === 'team') {
      allEntities = await aggregateGlobalTeams();
      // Sort by career average team rating descending — highest rated teams first
      sorted = allEntities.sort((a, b) => b.careerAvgTeamRating - a.careerAvgTeamRating);
    } else {
      // type === 'player'
      allEntities = await aggregateGlobalPlayers();
      // Sort by career total kills descending — most productive players first
      sorted = allEntities.sort((a, b) => b.careerKills - a.careerKills);
    }

    return corsJson({ type, limit, results: sorted.slice(0, limit) });
  } catch (err) {
    console.error('[overlay/rankings] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
