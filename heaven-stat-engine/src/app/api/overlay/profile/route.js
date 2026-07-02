/**
 * src/app/api/overlay/profile/route.js
 *
 * GET /api/overlay/profile?type={team|player}&id={entityId}
 *
 * Returns everything about one specific team or player:
 *   - Identity fields (name, logo, clan, etc.) from the global registry
 *   - Full career aggregate stats (same shape as one row from /api/overlay/rankings)
 *
 * This is the endpoint Player Card and Head-to-Head overlays should use.
 * The designer picks an ID, gets back everything pre-computed — no further
 * calculation is needed on the consuming side.
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
import { getTeam, getPlayer } from '@/lib/firestore/registry';
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
  const type = searchParams.get('type') || 'team';
  const id   = searchParams.get('id');

  if (!id) {
    return corsJson({ error: 'id is required' }, 400);
  }

  try {
    if (type === 'team') {
      // Fetch identity and career stats in parallel
      const [team, allTeams] = await Promise.all([
        getTeam(id),
        aggregateGlobalTeams(),
      ]);

      if (!team) {
        return corsJson({ error: 'team not found' }, 404);
      }

      const careerStats = allTeams.find((t) => t.id === id) || null;
      return corsJson({ type, profile: team, careerStats });
    } else {
      // type === 'player'
      const [player, allPlayers] = await Promise.all([
        getPlayer(id),
        aggregateGlobalPlayers(),
      ]);

      if (!player) {
        return corsJson({ error: 'player not found' }, 404);
      }

      const careerStats = allPlayers.find((p) => p.id === id) || null;
      return corsJson({ type, profile: player, careerStats });
    }
  } catch (err) {
    console.error('[overlay/profile] Error:', err);
    return corsJson({ error: 'internal server error' }, 500);
  }
}
