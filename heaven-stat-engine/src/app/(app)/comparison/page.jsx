'use client';
import { useState, useEffect, useMemo } from 'react';
import { getTeams, getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getTeamMatchResults, getBonusPoints, getPlayerMatchResults } from '@/lib/firestore/matchData';
import { computeTeamRanking } from '@/lib/engine/standings';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { ClassBadge, PlaystyleBadge } from '@/components/ui/Badge';
import { Shield, User, GitCompare, Trophy, Award, Target, Swords, Zap, Activity } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ComparisonPage() {
  const [mode, setMode] = useState('teams'); // 'teams' | 'players'
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState([]);
  const [players, setPlayers] = useState([]);

  // Selections
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  useEffect(() => {
    async function loadDataAndAggregate() {
      try {
        const [allRegistryTeams, allRegistryPlayers, allTournaments] = await Promise.all([
          getTeams(),
          getPlayers(),
          getTournaments(),
        ]);

        // Fetch match results and registrations for all tournaments in parallel
        const teamRegsPromises = allTournaments.map(t => getTeamRegistrations(t.id));
        const teamResPromises = allTournaments.map(t => getTeamMatchResults(t.id));
        const bonusPromises = allTournaments.map(t => getBonusPoints(t.id));
        const playerResPromises = allTournaments.map(t => getPlayerMatchResults(t.id));
        const playerRegsPromises = allTournaments.map(t => getPlayerRegistrations(t.id));

        const [
          allTeamRegs,
          allTeamRes,
          allTeamBonuses,
          allPlayerRes,
          allPlayerRegs
        ] = await Promise.all([
          Promise.all(teamRegsPromises),
          Promise.all(teamResPromises),
          Promise.all(bonusPromises),
          Promise.all(playerResPromises),
          Promise.all(playerRegsPromises)
        ]);

        // 1. Aggregate Career Stats for Teams
        const teamMap = {};
        allRegistryTeams.forEach(t => {
          teamMap[t.id] = {
            ...t,
            careerWins: 0,
            careerMatches: 0,
            careerPlacementPts: 0,
            careerKills: 0,
            careerBonusPts: 0,
            careerTotalPts: 0,
            tournamentsCount: 0,
            playstyle: '',
          };
        });

        allTournaments.forEach((tourney, index) => {
          const tRegs = allTeamRegs[index];
          const tRes = allTeamRes[index];
          const tBonuses = allTeamBonuses[index];

          // Compute standings for this tournament to get official points and wins
          const ranking = computeTeamRanking(tRes, tBonuses, tourney.scoring || {});

          ranking.forEach(tr => {
            const teamReg = tRegs.find(r => r.teamId === tr.teamId);
            if (teamReg && teamMap[tr.teamId]) {
              const tm = teamMap[tr.teamId];
              tm.careerWins += tr.wins || 0;
              tm.careerMatches += tr.matches || 0;
              tm.careerPlacementPts += tr.placementPts || 0;
              tm.careerKills += tr.kills || 0;
              tm.careerBonusPts += tr.bonusPts || 0;
              tm.careerTotalPts += tr.totalPts || 0;
              tm.tournamentsCount += 1;
            }
          });
        });

        // 2. Aggregate Career Stats for Players
        const playerMap = {};
        allRegistryPlayers.forEach(p => {
          playerMap[p.id] = {
            ...p,
            careerKills: 0,
            careerMatches: 0,
            careerDamage: 0,
            careerAccuracySum: 0,
            careerAccuracyCount: 0,
            tournamentsCount: 0,
            lastClass: 'Class 1',
            teamId: '',
            teamName: '—',
          };
        });

        allTournaments.forEach((tourney, index) => {
          const tResults = allPlayerRes[index];
          const tRegs = allPlayerRegs[index];

          tRegs.forEach(reg => {
            const pid = reg.playerId;
            if (playerMap[pid]) {
              const pm = playerMap[pid];
              pm.tournamentsCount += 1;
              if (reg.class) pm.lastClass = reg.class;
              if (reg.teamId) {
                pm.teamId = reg.teamId;
                pm.teamName = reg.teamName || '—';
              }
            }
          });

          tResults.forEach(res => {
            const pid = res.playerId;
            if (playerMap[pid]) {
              const pm = playerMap[pid];
              pm.careerKills += res.kills || 0;
              pm.careerMatches += 1;
              pm.careerDamage += res.damage || 0;
              if (res.accuracy != null && res.accuracy > 0) {
                pm.careerAccuracySum += res.accuracy;
                pm.careerAccuracyCount += 1;
              }
            }
          });
        });

        // Finalize Team list with derived statistics
        const teamsList = Object.values(teamMap).map(t => ({
          ...t,
          avgPointsPerMatch: t.careerMatches > 0 ? t.careerTotalPts / t.careerMatches : 0,
          avgKillsPerMatch: t.careerMatches > 0 ? t.careerKills / t.careerMatches : 0,
        }));

        // Finalize Player list with derived statistics
        const playersList = Object.values(playerMap).map(p => ({
          ...p,
          avgKillsPerMatch: p.careerMatches > 0 ? p.careerKills / p.careerMatches : 0,
          avgDamagePerMatch: p.careerMatches > 0 ? Math.round(p.careerDamage / p.careerMatches) : 0,
          avgAccuracy: p.careerAccuracyCount > 0 ? p.careerAccuracySum / p.careerAccuracyCount : 0,
        }));

        setTeams(teamsList);
        setPlayers(playersList);
      } catch (err) {
        toast.error('Failed to aggregate comparison databases: ' + err.message);
      } finally {
        setLoading(false);
      }
    }

    loadDataAndAggregate();
  }, []);

  const teamLookupMap = useMemo(() => {
    return Object.fromEntries(teams.map(t => [t.id, t]));
  }, [teams]);

  const entitiesList = mode === 'teams' ? teams : players;
  const leftEntity = entitiesList.find(e => e.id === leftId);
  const rightEntity = entitiesList.find(e => e.id === rightId);

  if (loading) return <LoadingSpinner size="lg" text="Aggregating performance metrics..." />;

  // Logo helper for entities
  const getLogoSrc = (entity) => {
    if (!entity) return null;
    if (mode === 'teams') {
      return entity.logo || entity.logoUrl;
    } else {
      // Find player's team logo from team map
      const t = teamLookupMap[entity.teamId];
      return t?.logo || t?.logoUrl;
    }
  };

  const logoSrcLeft = getLogoSrc(leftEntity);
  const logoSrcRight = getLogoSrc(rightEntity);

  const formattedLeft = leftEntity ? {
    name: mode === 'teams' ? leftEntity.teamName : leftEntity.professionalName,
    subLabel: mode === 'teams' ? `Clan: ${leftEntity.clanName || 'No Clan'}` : `IGN: ${leftEntity.ign || '—'} · Team: ${leftEntity.teamName || 'No Team'}`,
  } : null;

  const formattedRight = rightEntity ? {
    name: mode === 'teams' ? rightEntity.teamName : rightEntity.professionalName,
    subLabel: mode === 'teams' ? `Clan: ${rightEntity.clanName || 'No Clan'}` : `IGN: ${rightEntity.ign || '—'} · Team: ${rightEntity.teamName || 'No Team'}`,
  } : null;

  // Comparison stat helper
  const renderStatRow = (label, leftVal, rightVal, options = {}) => {
    const { isLowerBetter = false, isPercent = false, decimalPlaces = 0 } = options;
    const lValNum = Number(leftVal) || 0;
    const rValNum = Number(rightVal) || 0;

    let leftIsBetter = false;
    let rightIsBetter = false;

    if (lValNum !== rValNum) {
      if (isLowerBetter) {
        leftIsBetter = lValNum < rValNum;
        rightIsBetter = rValNum < lValNum;
      } else {
        leftIsBetter = lValNum > rValNum;
        rightIsBetter = rValNum > lValNum;
      }
    }

    const maxVal = Math.max(lValNum, rValNum) || 1;
    const leftPct = (lValNum / maxVal) * 100;
    const rightPct = (rValNum / maxVal) * 100;

    const formatVal = (val) => {
      const formatted = Number(val).toFixed(decimalPlaces);
      return isPercent ? `${formatted}%` : formatted;
    };

    return (
      <div key={label} className="comparison-stat-row mb-4">
        <div style={{ display: 'flex', width: '100%', alignItems: 'center' }}>
          {/* Left value */}
          <div style={{ width: '40%', textAlign: 'right', fontSize: '1.15rem', fontWeight: 700 }} className={leftIsBetter ? 'text-gold' : 'text-text-secondary'}>
            {formatVal(leftVal)}
          </div>
          
          {/* Label */}
          <div style={{ width: '20%', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </div>
          
          {/* Right value */}
          <div style={{ width: '40%', textAlign: 'left', fontSize: '1.15rem', fontWeight: 700 }} className={rightIsBetter ? 'text-gold' : 'text-text-secondary'}>
            {formatVal(rightVal)}
          </div>
        </div>

        {/* Visual progress bar comparison */}
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '24px', marginTop: '6px' }}>
          <div style={{ width: '50%', height: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${leftPct}%`,
              background: leftIsBetter ? 'var(--gold)' : 'var(--text-muted)',
              borderRadius: '999px',
              transition: 'width 0.5s ease-out'
            }} />
          </div>
          <div style={{ width: '50%', height: '6px', background: 'rgba(255,255,255,0.04)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${rightPct}%`,
              background: rightIsBetter ? 'var(--gold)' : 'var(--text-muted)',
              borderRadius: '999px',
              transition: 'width 0.5s ease-out'
            }} />
          </div>
        </div>
      </div>
    );
  };

  const renderBadgeRow = (label, leftBadge, rightBadge) => {
    return (
      <div key={label} className="comparison-stat-row mb-4">
        <div style={{ display: 'flex', width: '100%', alignItems: 'center' }}>
          {/* Left badge */}
          <div style={{ width: '40%', display: 'flex', justifyContent: 'flex-end' }}>
            {leftBadge}
          </div>
          
          {/* Label */}
          <div style={{ width: '20%', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </div>
          
          {/* Right badge */}
          <div style={{ width: '40%', display: 'flex', justifyContent: 'flex-start' }}>
            {rightBadge}
          </div>
        </div>
      </div>
    );
  };

  const renderTextRow = (label, leftText, rightText) => {
    return (
      <div key={label} className="comparison-stat-row mb-4">
        <div style={{ display: 'flex', width: '100%', alignItems: 'center' }}>
          {/* Left text */}
          <div style={{ width: '40%', textAlign: 'right', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {leftText || '—'}
          </div>
          
          {/* Label */}
          <div style={{ width: '20%', textAlign: 'center', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {label}
          </div>
          
          {/* Right text */}
          <div style={{ width: '40%', textAlign: 'left', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            {rightText || '—'}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Analysis &amp; Comparison</h1>
          <p className="page-subtitle">Compare professional teams and players head-to-head</p>
        </div>
      </div>

      {/* Selectors Bar */}
      <div className="card">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Pills Toggle */}
          <div style={{ display: 'inline-flex', background: 'var(--bg-header)', borderRadius: 'var(--r-sm)', padding: '4px', alignSelf: 'flex-start' }}>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'teams' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 16px', borderRadius: '4px', border: 'none' }}
              onClick={() => { setMode('teams'); setLeftId(''); setRightId(''); }}
            >
              <Shield size={14} style={{ marginRight: 6 }} /> Teams
            </button>
            <button
              type="button"
              className={`btn btn-sm ${mode === 'players' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ padding: '6px 16px', borderRadius: '4px', border: 'none' }}
              onClick={() => { setMode('players'); setLeftId(''); setRightId(''); }}
            >
              <User size={14} style={{ marginRight: 6 }} /> Players
            </button>
          </div>

          {/* Symmetrical dropdowns */}
          <div style={{ display: 'flex', flexGrow: 1, alignItems: 'center', gap: '16px', justifyContent: 'flex-end', width: '100%' }}>
            <select
              className="form-select"
              style={{ maxWidth: '280px', marginTop: 0 }}
              value={leftId}
              onChange={(e) => setLeftId(e.target.value)}
            >
              <option value="">-- Select {mode === 'teams' ? 'Team' : 'Player'} A --</option>
              {entitiesList.map(item => (
                <option key={item.id} value={item.id} disabled={item.id === rightId}>
                  {mode === 'teams' ? item.teamName : `${item.professionalName} (${item.ign})`}
                </option>
              ))}
            </select>

            <div className="text-text-muted font-bold text-xs flex-shrink-0">VS</div>

            <select
              className="form-select"
              style={{ maxWidth: '280px', marginTop: 0 }}
              value={rightId}
              onChange={(e) => setRightId(e.target.value)}
            >
              <option value="">-- Select {mode === 'teams' ? 'Team' : 'Player'} B --</option>
              {entitiesList.map(item => (
                <option key={item.id} value={item.id} disabled={item.id === leftId}>
                  {mode === 'teams' ? item.teamName : `${item.professionalName} (${item.ign})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Head-to-Head Section */}
      {(!leftEntity || !rightEntity) ? (
        <div className="card text-center py-16" style={{ borderStyle: 'dashed', borderColor: 'var(--border-gold)', borderWidth: '2px' }}>
          <GitCompare size={48} className="text-gold mx-auto mb-4 opacity-50" />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Select two {mode} to compare</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>Choose a left and right selection from the dropdown menus to view side-by-side career statistics.</p>
        </div>
      ) : (
        <div className="comparison-container animate-fade-in">
          {/* Head-to-Head Cards */}
          <div className="comparison-selectors">
            {/* Left Box */}
            <div className="comparison-card-header selected">
              {logoSrcLeft ? (
                <img src={logoSrcLeft} alt="" className="comparison-header-logo" width={72} height={72} />
              ) : (
                <Shield size={44} className="text-gold flex-shrink-0" />
              )}
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formattedLeft.name}</h2>
                <p className="text-sm text-text-secondary mt-1">{formattedLeft.subLabel}</p>
              </div>
            </div>

            {/* VS Badge */}
            <div className="comparison-vs-badge flex-shrink-0">VS</div>

            {/* Right Box */}
            <div className="comparison-card-header selected right-side">
              {logoSrcRight ? (
                <img src={logoSrcRight} alt="" className="comparison-header-logo" width={72} height={72} />
              ) : (
                <Shield size={44} className="text-gold flex-shrink-0" />
              )}
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formattedRight.name}</h2>
                <p className="text-sm text-text-secondary mt-1">{formattedRight.subLabel}</p>
              </div>
            </div>
          </div>

          {/* Stats List */}
          <div className="card">
            <h3 className="card-title mb-6 flex items-center gap-2 border-b border-border pb-3">
              <Activity size={18} className="text-gold" />
              Performance Statistics comparison
            </h3>

            {mode === 'teams' ? (
              <div>
                {renderStatRow('Total Points', leftEntity.careerTotalPts, rightEntity.careerTotalPts)}
                {renderStatRow('Lobby Wins', leftEntity.careerWins, rightEntity.careerWins)}
                {renderStatRow('Matches Played', leftEntity.careerMatches, rightEntity.careerMatches)}
                {renderStatRow('Placement Points', leftEntity.careerPlacementPts, rightEntity.careerPlacementPts)}
                {renderStatRow('Total Kills', leftEntity.careerKills, rightEntity.careerKills)}
                {renderStatRow('Bonus Points', leftEntity.careerBonusPts, rightEntity.careerBonusPts)}
                {renderStatRow('Avg Points / Match', leftEntity.avgPointsPerMatch, rightEntity.avgPointsPerMatch, { decimalPlaces: 2 })}
                {renderStatRow('Avg Kills / Match', leftEntity.avgKillsPerMatch, rightEntity.avgKillsPerMatch, { decimalPlaces: 2 })}
                {renderStatRow('Tournaments Played', leftEntity.tournamentsCount, rightEntity.tournamentsCount)}
                {renderTextRow('Clan Name', leftEntity.clanName, rightEntity.clanName)}
              </div>
            ) : (
              <div>
                {renderStatRow('Total Kills', leftEntity.careerKills, rightEntity.careerKills)}
                {renderStatRow('Matches Played', leftEntity.careerMatches, rightEntity.careerMatches)}
                {renderStatRow('Avg Kills / Match', leftEntity.avgKillsPerMatch, rightEntity.avgKillsPerMatch, { decimalPlaces: 2 })}
                {renderStatRow('Avg Damage', leftEntity.avgDamagePerMatch, rightEntity.avgDamagePerMatch)}
                {renderStatRow('Avg Accuracy', leftEntity.avgAccuracy, rightEntity.avgAccuracy, { isPercent: true, decimalPlaces: 2 })}
                {renderStatRow('Tournaments Played', leftEntity.tournamentsCount, rightEntity.tournamentsCount)}
                {renderBadgeRow('Class Rank', <ClassBadge playerClass={leftEntity.lastClass} />, <ClassBadge playerClass={rightEntity.lastClass} />)}
                {renderTextRow('Current Team', leftEntity.teamName, rightEntity.teamName)}
                {renderTextRow('Device Brand', leftEntity.device, rightEntity.device)}
                {renderTextRow('Device Model', leftEntity.deviceModel, rightEntity.deviceModel)}
                {renderTextRow('Region', leftEntity.region, rightEntity.region)}
                {renderTextRow('Country', leftEntity.country, rightEntity.country)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
