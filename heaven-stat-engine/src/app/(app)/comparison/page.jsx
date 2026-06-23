'use client';
import { useState, useEffect, useMemo } from 'react';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import { computeTeamAnalytics, getTeamRatingRankLabel } from '@/lib/engine/analytics';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge, RankBadge } from '@/components/ui/Badge';
import { Shield, User, GitCompare, Activity, BarChart2, Target, TrendingUp, Swords, Award, Star, Globe, Trophy } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

// ─── Colors ───────────────────────────────────────────────────────────────────
const COLOR_LEFT  = '#C9A84C';
const COLOR_RIGHT = '#38BDF8';
const COLOR_WIN   = '#22C55E';

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomBarTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-md)', borderRadius: 8, padding: '10px 14px', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--text-muted)', marginBottom: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.fill, fontWeight: 700 }}>{p.name}: {typeof p.value === 'number' && p.value % 1 !== 0 ? p.value.toFixed(2) : p.value}</p>
      ))}
    </div>
  );
};

// ─── Aggregate helpers ────────────────────────────────────────────────────────
function aggregateTeams(registryTeams, tournaments, allTeamRegs, allTeamRes, allTeamBonuses) {
  const teamMap = {};
  registryTeams.forEach(t => {
    teamMap[t.id] = { 
      ...t, 
      careerWins: 0, 
      careerMatches: 0, 
      careerPlacementPts: 0, 
      careerKills: 0, 
      careerBonusPts: 0, 
      careerTotalPts: 0, 
      tournamentsCount: 0,
      totalTeamRating: 0,
      teamRatingCount: 0,
      careerRankSum: 0,
      tournamentWins: 0,
      tournamentPPM: 0,
      tournamentKPM: 0,
      tournamentTop3Rate: 0,
      tournamentTop5Rate: 0,
    };
  });
  tournaments.forEach((tourney, index) => {
    const tourneyAnalytics = computeTeamAnalytics(allTeamRes[index] || [], allTeamBonuses[index] || [], tourney.scoring || {});
    const analyticsMap = {};
    tourneyAnalytics.forEach(ta => {
      analyticsMap[ta.teamId] = ta;
    });

    const ranking = computeTeamRanking(allTeamRes[index], allTeamBonuses[index], tourney.scoring || {});
    ranking.forEach(tr => {
      const reg = allTeamRegs[index].find(r => r.teamId === tr.teamId);
      if (reg && teamMap[tr.teamId]) {
        const tm = teamMap[tr.teamId];
        tm.careerWins         += tr.wins || 0;
        tm.careerMatches      += tr.matches || 0;
        tm.careerPlacementPts += tr.placementPts || 0;
        tm.careerKills        += tr.kills || 0;
        tm.careerBonusPts     += tr.bonusPts || 0;
        tm.careerTotalPts     += tr.totalPts || 0;
        tm.tournamentsCount   += 1;
        tm.careerRankSum      += tr.rank || 0;
        if (tr.rank === 1) {
          tm.tournamentWins += 1;
        }

        const teamAnalytics = analyticsMap[tr.teamId];
        if (teamAnalytics) {
          tm.tournamentPPM      = teamAnalytics.analytics?.PPM || 0;
          tm.tournamentKPM      = teamAnalytics.analytics?.KPM || 0;
          tm.tournamentTop3Rate = teamAnalytics.analytics?.top3Rate || 0;
          tm.tournamentTop5Rate = teamAnalytics.analytics?.top5Rate || 0;

          if (teamAnalytics.scores && typeof teamAnalytics.scores.FINAL_RATING === 'number') {
            tm.totalTeamRating += teamAnalytics.scores.FINAL_RATING;
            tm.teamRatingCount += 1;
          }
        }
      }
    });
  });
  return Object.values(teamMap).map(t => {
    const avgRating = t.teamRatingCount > 0 ? t.totalTeamRating / t.teamRatingCount : 0;
    return {
      ...t,
      winRate:           t.careerMatches > 0 ? (t.careerWins / t.careerMatches) * 100 : 0,
      avgPointsPerMatch: t.careerMatches > 0 ? t.careerTotalPts / t.careerMatches : 0,
      avgKillsPerMatch:  t.careerMatches > 0 ? t.careerKills / t.careerMatches : 0,
      careerAvgTeamRating: avgRating,
      careerAvgTeamRatingLabel: getTeamRatingRankLabel(avgRating),
      avgPlacementPtsPerTournament: t.tournamentsCount > 0 ? t.careerPlacementPts / t.tournamentsCount : 0,
      avgRankedPosition: t.tournamentsCount > 0 ? t.careerRankSum / t.tournamentsCount : 0,
    };
  }).filter(t => t.careerMatches > 0 || t.tournamentsCount > 0);
}

function aggregatePlayers(registryPlayers, allPlayerRegs, allPlayerRes) {
  const playerMap = {};
  registryPlayers.forEach(p => {
    playerMap[p.id] = { ...p, careerKills: 0, careerMatches: 0, careerDamage: 0, careerAccuracySum: 0, careerAccuracyCount: 0, tournamentsCount: 0, lastClass: 'Class 1', teamId: '', teamName: '—' };
  });
  allPlayerRegs.forEach(regs => {
    regs.forEach(reg => {
      if (playerMap[reg.playerId]) {
        const pm = playerMap[reg.playerId];
        pm.tournamentsCount += 1;
        if (reg.class) pm.lastClass = reg.class;
        if (reg.teamId) { pm.teamId = reg.teamId; pm.teamName = reg.teamName || '—'; }
      }
    });
  });
  allPlayerRes.forEach(results => {
    results.forEach(res => {
      if (playerMap[res.playerId]) {
        const pm = playerMap[res.playerId];
        pm.careerKills   += res.kills || 0;
        pm.careerMatches += 1;
        pm.careerDamage  += res.damage || 0;
        if (res.accuracy != null && res.accuracy > 0) { pm.careerAccuracySum += res.accuracy; pm.careerAccuracyCount += 1; }
      }
    });
  });
  return Object.values(playerMap).map(p => ({
    ...p,
    avgKillsPerMatch:   p.careerMatches > 0 ? p.careerKills / p.careerMatches : 0,
    avgDamagePerMatch:  p.careerMatches > 0 ? Math.round(p.careerDamage / p.careerMatches) : 0,
    avgAccuracy:        p.careerAccuracyCount > 0 ? p.careerAccuracySum / p.careerAccuracyCount : 0,
    killsPerTournament: p.tournamentsCount > 0 ? p.careerKills / p.tournamentsCount : 0,
    damagePerKill:      p.careerKills > 0 ? p.careerDamage / p.careerKills : 0,
  })).filter(p => p.careerMatches > 0 || p.tournamentsCount > 0);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ComparisonPage() {
  const [mode, setMode]                       = useState('teams');
  const [scope, setScope]                     = useState('global');   // 'global' | 'tournament'
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [loading, setLoading]                 = useState(true);
  const [leftId, setLeftId]                   = useState('');
  const [rightId, setRightId]                 = useState('');
  const [activeTab, setActiveTab]             = useState('overview');

  // ── Raw data (loaded once) ────────────────────────────────────────────────
  const [rawRegistryTeams, setRawRegistryTeams]   = useState([]);
  const [rawRegistryPlayers, setRawRegistryPlayers] = useState([]);
  const [allTournaments, setAllTournaments]        = useState([]);
  const [allTeamRegs, setAllTeamRegs]             = useState([]);
  const [allTeamRes, setAllTeamRes]               = useState([]);
  const [allTeamBonuses, setAllTeamBonuses]       = useState([]);
  const [allPlayerRes, setAllPlayerRes]           = useState([]);
  const [allPlayerRegs, setAllPlayerRegs]         = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const [registryTeams, registryPlayers, tournaments] = await Promise.all([
          getTeams(), getPlayers(), getTournaments(),
        ]);
        const [teamRegs, teamRes, teamBonuses, playerRes, playerRegs] = await Promise.all([
          Promise.all(tournaments.map(t => getTeamRegistrations(t.id))),
          Promise.all(tournaments.map(t => getTeamMatchResults(t.id))),
          Promise.all(tournaments.map(t => getBonusPoints(t.id))),
          Promise.all(tournaments.map(t => getPlayerMatchResults(t.id))),
          Promise.all(tournaments.map(t => getPlayerRegistrations(t.id))),
        ]);
        setRawRegistryTeams(registryTeams);
        setRawRegistryPlayers(registryPlayers);
        setAllTournaments(tournaments);
        setAllTeamRegs(teamRegs);
        setAllTeamRes(teamRes);
        setAllTeamBonuses(teamBonuses);
        setAllPlayerRes(playerRes);
        setAllPlayerRegs(playerRegs);
      } catch (err) {
        toast.error('Failed to load comparison data: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Derive scoped entity lists ────────────────────────────────────────────
  const { teams, players } = useMemo(() => {
    if (!allTournaments.length) return { teams: [], players: [] };

    let tourneyIndices;
    if (scope === 'global') {
      tourneyIndices = allTournaments.map((_, i) => i);
    } else {
      const idx = allTournaments.findIndex(t => t.id === selectedTournamentId);
      tourneyIndices = idx >= 0 ? [idx] : [];
    }

    const scopedTournaments  = tourneyIndices.map(i => allTournaments[i]);
    const scopedTeamRegs     = tourneyIndices.map(i => allTeamRegs[i] || []);
    const scopedTeamRes      = tourneyIndices.map(i => allTeamRes[i] || []);
    const scopedTeamBonuses  = tourneyIndices.map(i => allTeamBonuses[i] || []);
    const scopedPlayerRes    = tourneyIndices.map(i => allPlayerRes[i] || []);
    const scopedPlayerRegs   = tourneyIndices.map(i => allPlayerRegs[i] || []);

    return {
      teams:   aggregateTeams(rawRegistryTeams, scopedTournaments, scopedTeamRegs, scopedTeamRes, scopedTeamBonuses),
      players: aggregatePlayers(rawRegistryPlayers, scopedPlayerRegs, scopedPlayerRes),
    };
  }, [scope, selectedTournamentId, allTournaments, rawRegistryTeams, rawRegistryPlayers, allTeamRegs, allTeamRes, allTeamBonuses, allPlayerRes, allPlayerRegs]);

  const teamLookupMap = useMemo(() => Object.fromEntries(rawRegistryTeams.map(t => [t.id, t])), [rawRegistryTeams]);

  const entitiesList = mode === 'teams' ? teams : players;
  const leftEntity   = entitiesList.find(e => e.id === leftId)  || null;
  const rightEntity  = entitiesList.find(e => e.id === rightId) || null;

  // Reset selections when scope/tournament/mode changes
  const resetSelections = () => { setLeftId(''); setRightId(''); setActiveTab('overview'); };

  if (loading) return <LoadingSpinner size="lg" text="Loading comparison data..." />;

  const selectedTournament = allTournaments.find(t => t.id === selectedTournamentId);

  const getLogoSrc = (entity) => {
    if (!entity) return null;
    if (mode === 'teams') return entity.logo || entity.logoUrl;
    const t = teamLookupMap[entity.teamId];
    return t?.logo || t?.logoUrl;
  };

  const leftName  = leftEntity  ? (mode === 'teams' ? leftEntity.teamName  : leftEntity.professionalName)  : '';
  const rightName = rightEntity ? (mode === 'teams' ? rightEntity.teamName : rightEntity.professionalName) : '';

  // ── Render helpers ─────────────────────────────────────────────────────────
  const renderStatRow = (label, lv, rv, { isPercent = false, decimalPlaces = 0, isLowerBetter = false, leftBadge = null, rightBadge = null } = {}) => {
    const l = Number(lv) || 0, r = Number(rv) || 0;
    const leftWins  = l !== r && (isLowerBetter ? l < r : l > r);
    const rightWins = l !== r && (isLowerBetter ? r < l : r > l);
    const maxVal = Math.max(l, r) || 1;
    const fmt = (v) => { const s = Number(v).toFixed(decimalPlaces); return isPercent ? `${s}%` : s; };
    return (
      <div key={label} style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '40%', textAlign: 'right', fontSize: '1.1rem', fontWeight: 700, color: leftWins ? COLOR_LEFT : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
            {leftBadge}
            <span>{fmt(l)}</span>
          </div>
          <div style={{ width: '20%', textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          <div style={{ width: '40%', textAlign: 'left',  fontSize: '1.1rem', fontWeight: 700, color: rightWins ? COLOR_RIGHT : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '8px' }}>
            <span>{fmt(r)}</span>
            {rightBadge}
          </div>
        </div>
        <div style={{ display: 'flex', width: '100%', gap: 20, marginTop: 5 }}>
          <div style={{ width: '50%', height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 99, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(l / maxVal) * 100}%`, background: leftWins ? COLOR_LEFT : 'var(--text-muted)', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
          <div style={{ width: '50%', height: 5, background: 'rgba(255,255,255,0.04)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(r / maxVal) * 100}%`, background: rightWins ? COLOR_RIGHT : 'var(--text-muted)', borderRadius: 99, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>
    );
  };

  const renderTextRow = (label, lt, rt) => (
    <div key={label} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '40%', textAlign: 'right', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{lt || '—'}</div>
        <div style={{ width: '20%', textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ width: '40%', textAlign: 'left',  fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>{rt || '—'}</div>
      </div>
    </div>
  );

  const renderBadgeRow = (label, lb, rb) => (
    <div key={label} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ width: '40%', display: 'flex', justifyContent: 'flex-end' }}>{lb}</div>
        <div style={{ width: '20%', textAlign: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
        <div style={{ width: '40%', display: 'flex', justifyContent: 'flex-start' }}>{rb}</div>
      </div>
    </div>
  );

  const MetricCard = ({ label, icon: Icon, lv, rv, isPercent = false, decimalPlaces = 2, isLowerBetter = false, description = '', leftBadge = null, rightBadge = null }) => {
    const l = Number(lv) || 0, r = Number(rv) || 0;
    const leftWins  = l !== r && (isLowerBetter ? l < r : l > r);
    const rightWins = l !== r && (isLowerBetter ? r < l : r > l);
    const tied = l === r;
    const maxVal = Math.max(l, r) || 1;
    const fmt = (v) => { const s = Number(v).toFixed(decimalPlaces); return isPercent ? `${s}%` : s; };
    const diff = Math.abs(l - r);
    const diffPct = maxVal > 0 ? (diff / maxVal) * 100 : 0;
    return (
      <div style={{ background: 'var(--bg-card)', border: `1px solid ${tied ? 'var(--border)' : leftWins ? 'rgba(201,168,76,0.3)' : 'rgba(56,189,248,0.3)'}`, borderRadius: 12, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
        {!tied && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: leftWins ? `linear-gradient(90deg, ${COLOR_LEFT}, transparent)` : `linear-gradient(90deg, transparent, ${COLOR_RIGHT})` }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          {Icon && <Icon size={14} style={{ color: 'var(--text-muted)' }} />}
          <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)' }}>{label}</span>
          {description && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto', fontStyle: 'italic' }}>{description}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: COLOR_LEFT, marginBottom: 4, textTransform: 'uppercase' }}>{leftName}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: leftWins ? COLOR_LEFT : tied ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span>{fmt(l)}</span>
              {leftBadge}
            </div>
            {leftWins && <div style={{ fontSize: '0.65rem', marginTop: 4, color: COLOR_WIN, fontWeight: 700 }}>▲ +{fmt(diff)} ahead</div>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 99, background: 'var(--bg-header)', color: 'var(--text-muted)' }}>{tied ? 'TIE' : leftWins ? '←' : '→'}</span>
            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{diffPct.toFixed(0)}% gap</span>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: '0.7rem', fontWeight: 600, color: COLOR_RIGHT, marginBottom: 4, textTransform: 'uppercase' }}>{rightName}</div>
            <div style={{ fontSize: '1.8rem', fontWeight: 900, color: rightWins ? COLOR_RIGHT : tied ? 'var(--text-secondary)' : 'var(--text-muted)', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <span>{fmt(r)}</span>
              {rightBadge}
            </div>
            {rightWins && <div style={{ fontSize: '0.65rem', marginTop: 4, color: COLOR_WIN, fontWeight: 700 }}>▲ +{fmt(diff)} ahead</div>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 3, marginTop: 14, height: 6, borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ flex: l || 0.1, background: leftWins ? COLOR_LEFT : 'rgba(201,168,76,0.25)', borderRadius: '99px 0 0 99px', transition: 'flex 0.6s' }} />
          <div style={{ flex: r || 0.1, background: rightWins ? COLOR_RIGHT : 'rgba(56,189,248,0.25)', borderRadius: '0 99px 99px 0', transition: 'flex 0.6s' }} />
        </div>
      </div>
    );
  };

  // ── Chart data builders ────────────────────────────────────────────────────
  const buildTeamRadarData = (l, r) => {
    const base = [
      { metric: 'Avg Rating', [leftName]: normalize(l.careerAvgTeamRating, r.careerAvgTeamRating), [rightName]: normalize(r.careerAvgTeamRating, l.careerAvgTeamRating) },
      { metric: 'Lobby Wins', [leftName]: normalize(l.careerWins, r.careerWins),         [rightName]: normalize(r.careerWins, l.careerWins) },
      { metric: 'Kills',      [leftName]: normalize(l.careerKills, r.careerKills),       [rightName]: normalize(r.careerKills, l.careerKills) },
      { metric: 'Win Rate',   [leftName]: normalize(l.winRate, r.winRate),               [rightName]: normalize(r.winRate, l.winRate) },
    ];
    if (scope === 'global') {
      base.push({ metric: 'Tourney Wins', [leftName]: normalize(l.tournamentWins, r.tournamentWins), [rightName]: normalize(r.tournamentWins, l.tournamentWins) });
    } else {
      base.push({ metric: 'Placement Pts', [leftName]: normalize(l.careerPlacementPts, r.careerPlacementPts), [rightName]: normalize(r.careerPlacementPts, l.careerPlacementPts) });
    }
    return base;
  };

  const buildPlayerRadarData = (l, r) => [
    { metric: 'Kills',      [leftName]: normalize(l.careerKills, r.careerKills),          [rightName]: normalize(r.careerKills, l.careerKills) },
    { metric: 'Avg Kills',  [leftName]: normalize(l.avgKillsPerMatch, r.avgKillsPerMatch),[rightName]: normalize(r.avgKillsPerMatch, l.avgKillsPerMatch) },
    { metric: 'Avg Damage', [leftName]: normalize(l.avgDamagePerMatch, r.avgDamagePerMatch),[rightName]: normalize(r.avgDamagePerMatch, l.avgDamagePerMatch) },
    { metric: 'Accuracy',   [leftName]: normalize(l.avgAccuracy, r.avgAccuracy),          [rightName]: normalize(r.avgAccuracy, l.avgAccuracy) },
    { metric: 'Tournaments',[leftName]: normalize(l.tournamentsCount, r.tournamentsCount),[rightName]: normalize(r.tournamentsCount, l.tournamentsCount) },
    { metric: 'Dmg/Kill',   [leftName]: normalize(l.damagePerKill, r.damagePerKill),      [rightName]: normalize(r.damagePerKill, l.damagePerKill) },
  ];

  const buildTeamBarData  = (l, r) => {
    const base = [
      { name: 'Avg Rating',    [leftName]: +l.careerAvgTeamRating.toFixed(1),    [rightName]: +r.careerAvgTeamRating.toFixed(1) },
      { name: 'Wins',          [leftName]: l.careerWins,         [rightName]: r.careerWins },
      { name: 'Kills',         [leftName]: l.careerKills,        [rightName]: r.careerKills },
    ];
    if (scope === 'global') {
      base.push({ name: 'Tourney Wins', [leftName]: l.tournamentWins, [rightName]: r.tournamentWins });
    } else {
      base.push({ name: 'Placement Pts', [leftName]: l.careerPlacementPts, [rightName]: r.careerPlacementPts });
      base.push({ name: 'Bonus Pts', [leftName]: l.careerBonusPts, [rightName]: r.careerBonusPts });
    }
    return base;
  };

  const buildPlayerBarData = (l, r) => [
    { name: 'Total Kills',  [leftName]: l.careerKills,                           [rightName]: r.careerKills },
    { name: 'Avg Kills/M',  [leftName]: +l.avgKillsPerMatch.toFixed(2),         [rightName]: +r.avgKillsPerMatch.toFixed(2) },
    { name: 'Avg Damage',   [leftName]: l.avgDamagePerMatch,                    [rightName]: r.avgDamagePerMatch },
    { name: 'Accuracy %',   [leftName]: +l.avgAccuracy.toFixed(2),              [rightName]: +r.avgAccuracy.toFixed(2) },
    { name: 'Tournaments',  [leftName]: l.tournamentsCount,                     [rightName]: r.tournamentsCount },
  ];

  // ── Tally ──────────────────────────────────────────────────────────────────
  const tallyCounts = () => {
    if (!leftEntity || !rightEntity) return { left: 0, right: 0, tied: 0 };
    if (mode === 'teams') {
      let left = 0, right = 0, tied = 0;
      const compare = (l, r, lowerBetter = false) => {
        const valL = Number(l) || 0;
        const valR = Number(r) || 0;
        if (valL === valR) {
          tied++;
        } else if (lowerBetter ? valL < valR : valL > valR) {
          left++;
        } else {
          right++;
        }
      };
      compare(leftEntity.careerAvgTeamRating, rightEntity.careerAvgTeamRating);
      compare(leftEntity.avgRankedPosition, rightEntity.avgRankedPosition, true);
      compare(leftEntity.winRate, rightEntity.winRate);
      compare(leftEntity.careerWins, rightEntity.careerWins);
      compare(leftEntity.careerMatches, rightEntity.careerMatches);
      compare(leftEntity.avgPlacementPtsPerTournament, rightEntity.avgPlacementPtsPerTournament);
      compare(leftEntity.careerKills, rightEntity.careerKills);
      compare(leftEntity.avgKillsPerMatch, rightEntity.avgKillsPerMatch);
      return { left, right, tied };
    } else {
      const metrics = [leftEntity.careerKills, leftEntity.avgKillsPerMatch, leftEntity.avgDamagePerMatch, leftEntity.avgAccuracy, leftEntity.damagePerKill, leftEntity.careerMatches].map((lv, i) => ({ l: lv, r: [rightEntity.careerKills, rightEntity.avgKillsPerMatch, rightEntity.avgDamagePerMatch, rightEntity.avgAccuracy, rightEntity.damagePerKill, rightEntity.careerMatches][i] }));
      let left = 0, right = 0, tied = 0;
      metrics.forEach(({ l, r }) => { if (l > r) left++; else if (r > l) right++; else tied++; });
      return { left, right, tied };
    }
  };

  const tally = tallyCounts();
  const overallWinner = tally.left > tally.right ? 'left' : tally.right > tally.left ? 'right' : 'tied';
  const bothSelected  = leftEntity && rightEntity;

  // ── Scope needs tournament selected warning ────────────────────────────────
  const needsTournamentSelection = scope === 'tournament' && !selectedTournamentId;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Analysis & Comparison</h1>
          <p className="page-subtitle">Compare teams and players head-to-head — globally or within a specific tournament</p>
        </div>
      </div>

      {/* ── Scope + Controls Card ── */}
      <div className="card">
        {/* Scope Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', flexShrink: 0 }}>Scope:</span>
          <div style={{ display: 'inline-flex', background: 'var(--bg-header)', borderRadius: 'var(--r-sm)', padding: 4 }}>
            <button
              type="button"
              className={`btn btn-sm ${scope === 'global' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 18px', borderRadius: 4, border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => { setScope('global'); setSelectedTournamentId(''); resetSelections(); }}
            >
              <Globe size={13} /> Global
            </button>
            <button
              type="button"
              className={`btn btn-sm ${scope === 'tournament' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 18px', borderRadius: 4, border: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => { setScope('tournament'); resetSelections(); }}
            >
              <Trophy size={13} /> Tournament
            </button>
          </div>

          {/* Tournament selector (only when scope = tournament) */}
          {scope === 'tournament' && (
            <select
              className="form-select"
              style={{ maxWidth: 320, marginTop: 0, marginLeft: 8 }}
              value={selectedTournamentId}
              onChange={e => { setSelectedTournamentId(e.target.value); resetSelections(); }}
            >
              <option value="">— Select a Tournament —</option>
              {allTournaments.map(t => (
                <option key={t.id} value={t.id}>{t.name} · S{t.season} · {t.status}</option>
              ))}
            </select>
          )}

          {/* Scope context badge */}
          {scope === 'global' && (
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>Aggregating across all {allTournaments.length} tournament{allTournaments.length !== 1 ? 's' : ''}</span>
          )}
          {scope === 'tournament' && selectedTournament && (
            <span style={{ fontSize: '0.72rem', color: COLOR_LEFT, fontWeight: 700 }}>
              {selectedTournament.name} · Season {selectedTournament.season}
            </span>
          )}
        </div>

        {/* Mode + Entity Dropdowns */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Teams / Players toggle */}
          <div style={{ display: 'inline-flex', background: 'var(--bg-header)', borderRadius: 'var(--r-sm)', padding: 4, alignSelf: 'flex-start' }}>
            <button type="button" className={`btn btn-sm ${mode === 'teams' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '6px 16px', borderRadius: 4, border: 'none' }} onClick={() => { setMode('teams'); resetSelections(); }}>
              <Shield size={14} style={{ marginRight: 6 }} /> Teams
            </button>
            <button type="button" className={`btn btn-sm ${mode === 'players' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '6px 16px', borderRadius: 4, border: 'none' }} onClick={() => { setMode('players'); resetSelections(); }}>
              <User size={14} style={{ marginRight: 6 }} /> Players
            </button>
          </div>

          {/* Entity selectors */}
          <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', gap: 16, justifyContent: 'flex-end', opacity: needsTournamentSelection ? 0.4 : 1, pointerEvents: needsTournamentSelection ? 'none' : 'auto' }}>
            <select className="form-select" style={{ maxWidth: 280, marginTop: 0 }} value={leftId} onChange={e => setLeftId(e.target.value)}>
              <option value="">— {mode === 'teams' ? 'Team' : 'Player'} A —</option>
              {entitiesList.map(item => (
                <option key={item.id} value={item.id} disabled={item.id === rightId}>
                  {mode === 'teams' ? item.teamName : `${item.professionalName} (${item.ign})`}
                </option>
              ))}
            </select>
            <div style={{ fontWeight: 900, fontSize: '0.8rem', color: 'var(--text-muted)', flexShrink: 0, padding: '6px 12px', background: 'var(--bg-header)', borderRadius: 8 }}>VS</div>
            <select className="form-select" style={{ maxWidth: 280, marginTop: 0 }} value={rightId} onChange={e => setRightId(e.target.value)}>
              <option value="">— {mode === 'teams' ? 'Team' : 'Player'} B —</option>
              {entitiesList.map(item => (
                <option key={item.id} value={item.id} disabled={item.id === leftId}>
                  {mode === 'teams' ? item.teamName : `${item.professionalName} (${item.ign})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── Prompt to select tournament ── */}
      {needsTournamentSelection && (
        <div className="card text-center py-12" style={{ borderStyle: 'dashed', borderColor: 'var(--border-gold)', borderWidth: 2 }}>
          <Trophy size={40} className="text-gold mx-auto mb-3 opacity-50" />
          <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Select a tournament above</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 4 }}>Choose a specific tournament to compare {mode} stats within that event only.</p>
        </div>
      )}

      {/* ── No data in this tournament ── */}
      {!needsTournamentSelection && scope === 'tournament' && selectedTournamentId && entitiesList.length === 0 && (
        <div className="card text-center py-12">
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No {mode} data found for this tournament.</p>
        </div>
      )}

      {/* ── Empty entity state ── */}
      {!needsTournamentSelection && entitiesList.length > 0 && !bothSelected && (
        <div className="card text-center py-16" style={{ borderStyle: 'dashed', borderColor: 'var(--border-gold)', borderWidth: 2 }}>
          <GitCompare size={48} className="text-gold mx-auto mb-4 opacity-50" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Select two {mode} to compare</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {scope === 'tournament' ? `Comparing within: ${selectedTournament?.name}` : 'Career stats across all tournaments'}
          </p>
        </div>
      )}

      {/* ── Full comparison ── */}
      {bothSelected && (
        <div className="space-y-6">

          {/* Entity headers + tally */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 12, alignItems: 'center' }}>
            <EntityHeader entity={leftEntity} name={leftName} side="left" logo={getLogoSrc(leftEntity)} mode={mode} color={COLOR_LEFT} />
            <div style={{ textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 6 }}>Edge Count</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.8rem', fontWeight: 900, color: overallWinner === 'left' ? COLOR_LEFT : 'var(--text-muted)' }}>{tally.left}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 700 }}>–</span>
                <span style={{ fontSize: '1.8rem', fontWeight: 900, color: overallWinner === 'right' ? COLOR_RIGHT : 'var(--text-muted)' }}>{tally.right}</span>
              </div>
              <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 2 }}>{tally.tied} tied</div>
              {overallWinner !== 'tied' && (
                <div style={{ marginTop: 6, fontSize: '0.65rem', fontWeight: 800, color: COLOR_WIN, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {overallWinner === 'left' ? leftName : rightName} leads
                </div>
              )}
              {/* Scope badge */}
              <div style={{ marginTop: 10, fontSize: '0.6rem', padding: '3px 8px', borderRadius: 99, background: scope === 'tournament' ? 'rgba(201,168,76,0.12)' : 'rgba(56,189,248,0.1)', color: scope === 'tournament' ? COLOR_LEFT : COLOR_RIGHT, border: `1px solid ${scope === 'tournament' ? 'rgba(201,168,76,0.25)' : 'rgba(56,189,248,0.2)'}`, fontWeight: 700, textTransform: 'uppercase' }}>
                {scope === 'global' ? 'Global' : 'Tournament'}
              </div>
            </div>
            <EntityHeader entity={rightEntity} name={rightName} side="right" logo={getLogoSrc(rightEntity)} mode={mode} color={COLOR_RIGHT} />
          </div>

          {/* Analysis tabs */}
          <div className="tab-bar">
            <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>
              <Activity size={13} style={{ marginRight: 5 }} /> Overview Stats
            </button>
            <button className={`tab ${activeTab === 'advanced' ? 'active' : ''}`} onClick={() => setActiveTab('advanced')}>
              <Target size={13} style={{ marginRight: 5 }} /> Advanced Breakdown
            </button>
            <button className={`tab ${activeTab === 'charts' ? 'active' : ''}`} onClick={() => setActiveTab('charts')}>
              <BarChart2 size={13} style={{ marginRight: 5 }} /> Graphical Analysis
            </button>
          </div>

          {/* ── Overview ── */}
          {activeTab === 'overview' && (
            <div className="card">
              <h3 className="card-title mb-6 flex items-center gap-2 border-b border-border pb-3">
                <Activity size={18} className="text-gold" /> Performance Statistics Comparison
                {scope === 'tournament' && selectedTournament && (
                  <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: COLOR_LEFT, fontWeight: 700 }}>{selectedTournament.name}</span>
                )}
              </h3>
              {mode === 'teams' ? (
                <div>
                  {renderStatRow('Average Team Rating', leftEntity.careerAvgTeamRating, rightEntity.careerAvgTeamRating, {
                    decimalPlaces: 1,
                    leftBadge: <RankBadge label={leftEntity.careerAvgTeamRatingLabel} />,
                    rightBadge: <RankBadge label={rightEntity.careerAvgTeamRatingLabel} />
                  })}
                  {scope === 'global' && renderStatRow('Tournament Wins', leftEntity.tournamentWins, rightEntity.tournamentWins)}
                  {renderStatRow('Lobby Wins',         leftEntity.careerWins,        rightEntity.careerWins)}
                  {renderStatRow('Matches Played',     leftEntity.careerMatches,     rightEntity.careerMatches)}
                  {scope === 'tournament' && renderStatRow('Placement Points', leftEntity.careerPlacementPts, rightEntity.careerPlacementPts)}
                  {renderStatRow('Total Kills',        leftEntity.careerKills,       rightEntity.careerKills)}
                  {scope === 'tournament' && renderStatRow('Bonus Points', leftEntity.careerBonusPts, rightEntity.careerBonusPts)}
                  {renderStatRow('Avg Kills / Match',  leftEntity.avgKillsPerMatch,  rightEntity.avgKillsPerMatch,  { decimalPlaces: 2 })}
                  {renderStatRow('Win Rate',           leftEntity.winRate,           rightEntity.winRate,           { isPercent: true, decimalPlaces: 1 })}
                  {scope === 'tournament' && (
                    <>
                      {renderStatRow('Points Per Match', leftEntity.tournamentPPM, rightEntity.tournamentPPM, { decimalPlaces: 2 })}
                      {renderStatRow('Kills Per Match',  leftEntity.tournamentKPM, rightEntity.tournamentKPM, { decimalPlaces: 2 })}
                      {renderStatRow('Top 3 Rate',       leftEntity.tournamentTop3Rate, rightEntity.tournamentTop3Rate, { isPercent: true, decimalPlaces: 1 })}
                      {renderStatRow('Top 5 Rate',       leftEntity.tournamentTop5Rate, rightEntity.tournamentTop5Rate, { isPercent: true, decimalPlaces: 1 })}
                    </>
                  )}
                  {scope === 'global' && renderStatRow('Tournaments Played', leftEntity.tournamentsCount, rightEntity.tournamentsCount)}
                  {renderTextRow('Clan Name',          leftEntity.clanName,          rightEntity.clanName)}
                </div>
              ) : (
                <div>
                  {renderStatRow('Total Kills',        leftEntity.careerKills,       rightEntity.careerKills)}
                  {renderStatRow('Matches Played',     leftEntity.careerMatches,     rightEntity.careerMatches)}
                  {renderStatRow('Avg Kills / Match',  leftEntity.avgKillsPerMatch,  rightEntity.avgKillsPerMatch,  { decimalPlaces: 2 })}
                  {renderStatRow('Avg Damage / Match', leftEntity.avgDamagePerMatch, rightEntity.avgDamagePerMatch)}
                  {renderStatRow('Avg Accuracy',       leftEntity.avgAccuracy,       rightEntity.avgAccuracy,       { isPercent: true, decimalPlaces: 2 })}
                  {renderStatRow('Damage / Kill',      leftEntity.damagePerKill,     rightEntity.damagePerKill,     { decimalPlaces: 1 })}
                  {scope === 'global' && renderStatRow('Tournaments', leftEntity.tournamentsCount, rightEntity.tournamentsCount)}
                  {renderBadgeRow('Class', <ClassBadge playerClass={leftEntity.lastClass} />, <ClassBadge playerClass={rightEntity.lastClass} />)}
                  {renderTextRow('Team',   leftEntity.teamName, rightEntity.teamName)}
                  {renderTextRow('Device', leftEntity.device,   rightEntity.device)}
                  {renderTextRow('Region', leftEntity.region,   rightEntity.region)}
                </div>
              )}
            </div>
          )}

          {/* ── Advanced Breakdown ── */}
          {activeTab === 'advanced' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {mode === 'teams' ? (<>
                <MetricCard label="Average Team Rating" icon={Star}      lv={leftEntity.careerAvgTeamRating} rv={rightEntity.careerAvgTeamRating} decimalPlaces={1} description="Mean Team Rating" leftBadge={<RankBadge label={leftEntity.careerAvgTeamRatingLabel} />} rightBadge={<RankBadge label={rightEntity.careerAvgTeamRatingLabel} />} />
                {scope === 'global' && (
                  <>
                    <MetricCard label="Avg Ranked Position" icon={Trophy}    lv={leftEntity.avgRankedPosition}    rv={rightEntity.avgRankedPosition}    decimalPlaces={2} isLowerBetter description="Mean tournament rank" />
                    <MetricCard label="Tournament Wins"     icon={Award}     lv={leftEntity.tournamentWins}        rv={rightEntity.tournamentWins}        decimalPlaces={0} description="1st place standings" />
                  </>
                )}
                <MetricCard label="Lobby Wins"         icon={Award}     lv={leftEntity.careerWins}        rv={rightEntity.careerWins}        decimalPlaces={0} description="1st place finishes" />
                <MetricCard label="Win Rate"           icon={TrendingUp}lv={leftEntity.winRate}           rv={rightEntity.winRate}           decimalPlaces={1} isPercent description="Wins ÷ matches" />
                <MetricCard label="Total Kills"        icon={Swords}    lv={leftEntity.careerKills}       rv={rightEntity.careerKills}       decimalPlaces={0} description="Career kills" />
                <MetricCard label="Avg Kills / Match"  icon={Swords}    lv={leftEntity.avgKillsPerMatch}  rv={rightEntity.avgKillsPerMatch}  decimalPlaces={2} description="Kill pace" />
                <MetricCard label="Matches Played"     icon={Activity}  lv={leftEntity.careerMatches}    rv={rightEntity.careerMatches}     decimalPlaces={0} description="Total lobbies" />
                {scope === 'tournament' && (
                  <>
                    <MetricCard label="Placement Points"   icon={Target}    lv={leftEntity.careerPlacementPts}rv={rightEntity.careerPlacementPts}decimalPlaces={0} description="From placements" />
                    <MetricCard label="Bonus Points"       icon={Star}      lv={leftEntity.careerBonusPts}   rv={rightEntity.careerBonusPts}    decimalPlaces={0} description="From bonuses" />
                    <MetricCard label="Points Per Match"   icon={TrendingUp}lv={leftEntity.tournamentPPM}    rv={rightEntity.tournamentPPM}     decimalPlaces={2} description="PPM" />
                    <MetricCard label="Kills Per Match"    icon={Swords}    lv={leftEntity.tournamentKPM}    rv={rightEntity.tournamentKPM}     decimalPlaces={2} description="KPM" />
                    <MetricCard label="Top 3 Rate"         icon={Star}      lv={leftEntity.tournamentTop3Rate} rv={rightEntity.tournamentTop3Rate} decimalPlaces={1} isPercent description="Top 3 finishes" />
                    <MetricCard label="Top 5 Rate"         icon={Star}      lv={leftEntity.tournamentTop5Rate} rv={rightEntity.tournamentTop5Rate} decimalPlaces={1} isPercent description="Top 5 finishes" />
                  </>
                )}
              </>) : (<>
                <MetricCard label="Career Kills"       icon={Swords}    lv={leftEntity.careerKills}        rv={rightEntity.careerKills}        decimalPlaces={0} description="All-time kills" />
                <MetricCard label="Avg Kills / Match"  icon={Swords}    lv={leftEntity.avgKillsPerMatch}   rv={rightEntity.avgKillsPerMatch}   decimalPlaces={2} description="Kill pace" />
                <MetricCard label="Avg Damage / Match" icon={Target}    lv={leftEntity.avgDamagePerMatch}  rv={rightEntity.avgDamagePerMatch}  decimalPlaces={0} description="Damage output" />
                <MetricCard label="Avg Accuracy"       icon={Target}    lv={leftEntity.avgAccuracy}        rv={rightEntity.avgAccuracy}        decimalPlaces={2} isPercent description="Hit rate" />
                <MetricCard label="Damage / Kill"      icon={Activity}  lv={leftEntity.damagePerKill}      rv={rightEntity.damagePerKill}      decimalPlaces={1} description="Efficiency" />
                <MetricCard label="Kills / Tournament" icon={Star}      lv={leftEntity.killsPerTournament} rv={rightEntity.killsPerTournament} decimalPlaces={1} description="Per event" />
                <MetricCard label="Matches Played"     icon={Activity}  lv={leftEntity.careerMatches}      rv={rightEntity.careerMatches}      decimalPlaces={0} description="Total lobbies" />
              </>)}
            </div>
          )}

          {/* ── Charts ── */}
          {activeTab === 'charts' && (
            <div className="space-y-6">
              <div style={{ display: 'flex', gap: 24, justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: COLOR_LEFT }} />{leftName}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ width: 14, height: 14, borderRadius: 3, background: COLOR_RIGHT }} />{rightName}</div>
              </div>

              {/* Radar */}
              <div className="card">
                <h3 className="card-title mb-4 flex items-center gap-2">
                  <Target size={18} className="text-gold" /> Performance Radar Profile
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>Normalised 0–100 scores across key dimensions. Larger area = stronger overall profile.</p>
                <ResponsiveContainer width="100%" height={360}>
                  <RadarChart data={mode === 'teams' ? buildTeamRadarData(leftEntity, rightEntity) : buildPlayerRadarData(leftEntity, rightEntity)}>
                    <PolarGrid stroke="rgba(255,255,255,0.06)" />
                    <PolarAngleAxis dataKey="metric" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontWeight: 600 }} />
                    <Radar name={leftName}  dataKey={leftName}  stroke={COLOR_LEFT}  fill={COLOR_LEFT}  fillOpacity={0.18} strokeWidth={2} dot={{ r: 4, fill: COLOR_LEFT }} />
                    <Radar name={rightName} dataKey={rightName} stroke={COLOR_RIGHT} fill={COLOR_RIGHT} fillOpacity={0.18} strokeWidth={2} dot={{ r: 4, fill: COLOR_RIGHT }} />
                    <Tooltip content={<CustomBarTooltip />} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {/* Bar chart */}
              <div className="card">
                <h3 className="card-title mb-4 flex items-center gap-2">
                  <BarChart2 size={18} style={{ color: COLOR_RIGHT }} /> Metric-by-Metric Bar Comparison
                </h3>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>Raw values side-by-side. Hover for exact figures.</p>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={mode === 'teams' ? buildTeamBarData(leftEntity, rightEntity) : buildPlayerBarData(leftEntity, rightEntity)} barGap={4} barCategoryGap="28%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                    <Bar dataKey={leftName}  fill={COLOR_LEFT}  radius={[4,4,0,0]} maxBarSize={36} />
                    <Bar dataKey={rightName} fill={COLOR_RIGHT} radius={[4,4,0,0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Points composition (teams only) */}
              {mode === 'teams' && scope === 'tournament' && (
                <div className="card">
                  <h3 className="card-title mb-4 flex items-center gap-2">
                    <Activity size={18} className="text-gold" /> Points Composition Breakdown
                  </h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 20 }}>How each team earns their points — placement vs. kills vs. bonuses.</p>
                  {[leftEntity, rightEntity].map((entity, i) => {
                    const total = entity.careerTotalPts || 1;
                    const placePct = Math.round((entity.careerPlacementPts / total) * 100);
                    const killPct  = Math.round(((entity.careerTotalPts - entity.careerPlacementPts - entity.careerBonusPts) / total) * 100);
                    const bonusPct = Math.round((entity.careerBonusPts / total) * 100);
                    const name  = i === 0 ? leftName : rightName;
                    const color = i === 0 ? COLOR_LEFT : COLOR_RIGHT;
                    return (
                      <div key={entity.id} style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color }}>{name}</span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{entity.careerTotalPts} total pts</span>
                        </div>
                        <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', gap: 2 }}>
                          <div title={`Placement: ${placePct}%`} style={{ flex: placePct || 0.1, background: '#6366F1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {placePct > 8 && <span style={{ fontSize: '0.6rem', color: '#fff', fontWeight: 700 }}>{placePct}%</span>}
                          </div>
                          <div title={`Kill Pts: ${killPct}%`} style={{ flex: killPct || 0.1, background: color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {killPct > 8 && <span style={{ fontSize: '0.6rem', color: '#000', fontWeight: 700 }}>{killPct}%</span>}
                          </div>
                          <div title={`Bonus: ${bonusPct}%`} style={{ flex: Math.max(bonusPct, 0.5), background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {bonusPct > 8 && <span style={{ fontSize: '0.6rem', color: '#fff', fontWeight: 700 }}>{bonusPct}%</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div style={{ display: 'flex', gap: 20, marginTop: 8, fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#6366F1', display: 'inline-block' }} />Placement</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: COLOR_LEFT, display: 'inline-block' }} />Kill Points</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#22C55E', display: 'inline-block' }} />Bonus</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────
function EntityHeader({ entity, name, side, logo, mode, color }) {
  const isLeft = side === 'left';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isLeft ? 'flex-start' : 'flex-end', background: 'var(--bg-card)', border: `1px solid ${color}33`, borderRadius: 12, padding: '16px 20px', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexDirection: isLeft ? 'row' : 'row-reverse' }}>
        {logo
          ? <img src={logo} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: `2px solid ${color}` }} />
          : <div style={{ width: 52, height: 52, borderRadius: 10, background: `${color}22`, border: `2px solid ${color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Shield size={24} style={{ color }} /></div>
        }
        <div style={{ textAlign: isLeft ? 'left' : 'right' }}>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)' }}>{name}</div>
          {mode === 'players' && entity.ign && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>IGN: {entity.ign}</div>}
          {mode === 'players' && entity.teamName && entity.teamName !== '—' && <div style={{ fontSize: '0.75rem', color }}>{entity.teamName}</div>}
          {mode === 'teams' && entity.clanName && <div style={{ fontSize: '0.75rem', color }}>Clan: {entity.clanName}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: isLeft ? 'flex-start' : 'flex-end' }}>
        {mode === 'teams' ? (<>
          <Pill label="Pts"     value={entity.careerTotalPts}            color={color} />
          <Pill label="Wins"    value={entity.careerWins}                color={color} />
          <Pill label="Matches" value={entity.careerMatches}             color={color} />
        </>) : (<>
          <Pill label="Kills"   value={entity.careerKills}               color={color} />
          <Pill label="Matches" value={entity.careerMatches}             color={color} />
          <Pill label="Avg K"   value={entity.avgKillsPerMatch?.toFixed(1)} color={color} />
        </>)}
      </div>
    </div>
  );
}

function Pill({ label, value, color }) {
  return (
    <div style={{ background: `${color}15`, border: `1px solid ${color}30`, borderRadius: 8, padding: '4px 10px', textAlign: 'center' }}>
      <div style={{ fontSize: '0.9rem', fontWeight: 800, color }}>{value ?? '—'}</div>
      <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
    </div>
  );
}

function normalize(val, against) {
  const max = Math.max(Number(val) || 0, Number(against) || 0);
  if (!max) return 0;
  return Math.round(((Number(val) || 0) / max) * 100);
}
