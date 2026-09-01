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
          const isSoloTourney = t.format === 'solo' || t.isSolo === true;
          const distinctTeammatesInTourney = new Set(playerResults.filter(pr => pr.teamId === myTeamId).map(pr => pr.playerId)).size;
          const teamMatchesForMyTeam = teamResults.filter(tr => tr.teamId === myTeamId);
          const processedMatchKeys = new Set();

          teamMatchesForMyTeam.forEach(tm => {
            const matchKey = `${tm.day}-${tm.lobby}${tm.groupId ? '-' + tm.groupId : ''}`;
            processedMatchKeys.add(matchKey);

            // All player results in the same match for this team
            const allPlayerResultsThisMatch = playerResults.filter(pr =>
              pr.teamId === myTeamId &&
              pr.day === tm.day &&
              pr.lobby === tm.lobby &&
              (tm.groupId ? pr.groupId === tm.groupId : true)
            );

            const distinctPlayersThisMatch = new Set(allPlayerResultsThisMatch.map(pr => pr.playerId)).size;
            const teamSize = isSoloTourney
              ? 1
              : (distinctPlayersThisMatch > 1
                  ? distinctPlayersThisMatch
                  : (distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : (t.playersPerTeam || 4)));

            // My own result for this match
            const myResult = allPlayerResultsThisMatch.find(pr => pr.playerId === id);
            const present = Boolean(myResult);

            // Team total damage: sum of all player damages in this match, or estimated from team kills
            let teamTotalDamage = allPlayerResultsThisMatch.reduce((s, pr) => s + (pr.damage || 0), 0);
            if (myResult?.damage && teamTotalDamage <= myResult.damage && (tm.kills || 0) > (myResult?.kills || 0)) {
              teamTotalDamage = myResult.kills > 0
                ? Math.round((myResult.damage / myResult.kills) * (tm.kills || 1))
                : myResult.damage + ((tm.kills || 1) * 250);
            }

            teamMatchHistory.push({
              matchId: `${t.id}-${matchKey}`,
              teamId: myTeamId,
              present,
              placement: tm.placement || 0,
              teamTotalKills: tm.kills || myResult?.kills || 0,
              playerKills: myResult?.kills || 0,
              playerDamage: myResult?.damage || 0,
              teamTotalDamage,
              teamSize,
              isSolo: isSoloTourney,
            });
          });

          // Handle player matches that might not be in teamResults
          myPlayerResults.forEach(pr => {
            const matchKey = `${pr.day}-${pr.lobby}${pr.groupId ? '-' + pr.groupId : ''}`;
            if (processedMatchKeys.has(matchKey)) return;
            processedMatchKeys.add(matchKey);

            const allPlayerResultsThisMatch = playerResults.filter(r =>
              r.teamId === myTeamId &&
              r.day === pr.day &&
              r.lobby === pr.lobby &&
              (pr.groupId ? r.groupId === pr.groupId : true)
            );

            const distinctPlayersThisMatch = new Set(allPlayerResultsThisMatch.map(r => r.playerId)).size;
            const teamSize = isSoloTourney
              ? 1
              : (distinctPlayersThisMatch > 1
                  ? distinctPlayersThisMatch
                  : (distinctTeammatesInTourney > 1 ? distinctTeammatesInTourney : (t.playersPerTeam || 4)));

            const teamTotalKills = allPlayerResultsThisMatch.reduce((s, r) => s + (r.kills || 0), 0);
            const teamTotalDamage = allPlayerResultsThisMatch.reduce((s, r) => s + (r.damage || 0), 0);

            teamMatchHistory.push({
              matchId: `${t.id}-${matchKey}`,
              teamId: myTeamId,
              present: true,
              placement: pr.placement || 0,
              teamTotalKills: teamTotalKills || pr.kills || 0,
              playerKills: pr.kills || 0,
              playerDamage: pr.damage || 0,
              teamTotalDamage: teamTotalDamage || pr.damage || 0,
              teamSize,
              isSolo: isSoloTourney,
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

