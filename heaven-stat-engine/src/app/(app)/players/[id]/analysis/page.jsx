'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePlayer } from '../layout';
import { useAuth } from '@/contexts/AuthContext';
import { getTournament, getAllRegistrationsForPlayer } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults, getTeamMatchResults, getAllMatchResultsForPlayer } from '@/lib/firestore/matchData';
import { computePlayerInfluence } from '@/lib/engine/playerInfluence';
import { computePlayerXGSummary } from '@/lib/engine/globalForm';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PlayerInfluenceCard from '@/components/analytics/PlayerInfluenceCard';
import { Activity } from 'lucide-react';

export default function PlayerAnalysisPage() {
  const { id } = useParams();
  const { player } = usePlayer();
  const { isOwner } = useAuth();

  const [loading, setLoading] = useState(true);
  const [influence, setInfluence] = useState(null);
  const [xgSummary, setXgSummary] = useState(null);

  useEffect(() => {
    if (!isOwner) return;
    async function load() {
      try {
        // 1. Fetch this player's registrations and match results directly across all tournaments
        const [myPlayerRegs, myPlayerMatches] = await Promise.all([
          getAllRegistrationsForPlayer(id),
          getAllMatchResultsForPlayer(id),
        ]);

        // 2. Extract unique tournament IDs where this player registered
        const tourneyIdSet = new Set();
        myPlayerRegs.forEach(r => { if (r.tournamentId) tourneyIdSet.add(r.tournamentId); });
        myPlayerMatches.forEach(m => { if (m.tournamentId) tourneyIdSet.add(m.tournamentId); });
        const relevantTourneyIds = Array.from(tourneyIdSet);

        // 3. Fetch tournaments, team results, and player results ONLY for relevant tournaments
        const [relevantTourneys, allTeamRes, allPlayerRes] = await Promise.all([
          Promise.all(relevantTourneyIds.map(tId => getTournament(tId))),
          Promise.all(relevantTourneyIds.map(tId => getTeamMatchResults(tId))),
          Promise.all(relevantTourneyIds.map(tId => getPlayerMatchResults(tId))),
        ]);

        const teamMatchHistory = [];
        const playerMatchesForXG = [];

        relevantTourneys.forEach((t, tIdx) => {
          if (!t) return;
          const playerResults = allPlayerRes[tIdx] || [];
          const teamResults   = allTeamRes[tIdx]   || [];

          // Find this player's registration for this tournament
          const myReg = myPlayerRegs.find(r => r.tournamentId === t.id);
          const myTeamId = myReg?.teamId || playerResults.find(pr => pr.playerId === id)?.teamId;
          if (!myTeamId) return;

          // Resolve event date for xG decay
          let eventDate = null;
          if (t.eventStartDate) {
            eventDate = new Date(t.eventStartDate);
          } else if (t.createdAt?.seconds) {
            eventDate = new Date(t.createdAt.seconds * 1000);
          } else if (t.createdAt?.toDate) {
            eventDate = t.createdAt.toDate();
          } else {
            eventDate = new Date(0);
          }

          // Collect this player's own match results for xG
          const myPlayerResults = playerResults.filter(pr => pr.playerId === id);
          myPlayerResults.forEach(pr => {
            playerMatchesForXG.push({
              kills:    pr.kills    || 0,
              accuracy: pr.accuracy || null,
              damage:   pr.damage   || null,
              date:     eventDate,
            });
          });

          // Find all team matches this player's team played in this tournament
          const teamMatchesForMyTeam = teamResults.filter(tr => tr.teamId === myTeamId);

          teamMatchesForMyTeam.forEach(tm => {
            const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;

            // All player results in the same match for this team
            const allPlayerResultsThisMatch = playerResults.filter(pr =>
              pr.teamId === myTeamId &&
              pr.day === tm.day &&
              pr.lobby === tm.lobby &&
              (tm.groupId ? pr.groupId === tm.groupId : true)
            );

            const teamSize = new Set(allPlayerResultsThisMatch.map(pr => pr.playerId)).size || 1;

            // My own result for this match
            const myResult = allPlayerResultsThisMatch.find(pr => pr.playerId === id);
            const present = Boolean(myResult);

            // Team total damage: sum of all player damages in this match
            const teamTotalDamage = allPlayerResultsThisMatch.reduce((s, pr) => s + (pr.damage || 0), 0);

            teamMatchHistory.push({
              matchId: `${t.id}-${matchKey}`,
              teamId: myTeamId,
              present,
              placement: tm.placement || 0,
              teamTotalKills: tm.kills || 0,
              playerKills: myResult?.kills || 0,
              playerDamage: myResult?.damage || 0,
              teamTotalDamage,
              teamSize,
            });
          });
        });

        const result = computePlayerInfluence(id, teamMatchHistory);
        setInfluence(result);

        const xg = computePlayerXGSummary(playerMatchesForXG);
        setXgSummary(xg);
      } catch (err) {
        console.error('Analysis load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, isOwner]);

  if (loading) return <LoadingSpinner size="lg" text="Computing player analysis…" />;

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 style={{
          fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)',
          display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4,
        }}>
          <Activity size={18} style={{ color: 'var(--gold)' }} />
          Breakdown Analysis
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px',
            borderRadius: 4, background: 'rgba(201,168,76,0.12)',
            color: 'var(--gold)', border: '1px solid var(--border-gold)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            Beta
          </span>
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          Advanced influence metrics — only duo/trio/squad matches are included.
        </p>
      </div>

      <PlayerInfluenceCard influence={influence} xgSummary={xgSummary} />
    </div>
  );
}

