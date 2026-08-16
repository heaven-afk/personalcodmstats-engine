'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Coins, Search, Download, ArrowLeft, ArrowUpDown, ArrowUp, ArrowDown,
  Users, Shield, Flame, Sparkles, Filter, Check
} from 'lucide-react';
import toast from 'react-hot-toast';
import Papa from 'papaparse';
import { getPlayers } from '@/lib/firestore/registry';
import { getTournaments, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getPlayerMatchResults } from '@/lib/firestore/matchData';
import { RankBadge } from '@/components/ui/Badge';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import MetricTooltip from '@/components/ui/MetricTooltip';
import { computePlayerGlobalForm, globalFormLabel } from '@/lib/engine/globalForm';
import { computePlayerFantasyCost } from '@/lib/engine/fantasy';

export default function FantasyPricingPage() {
  const [playersList, setPlayersList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search & Filter
  const [search, setSearch] = useState('');

  // Sorting
  const [sortKey, setSortKey] = useState('cost'); // 'cost' | 'professionalName' | 'ign' | 'lastTeam' | 'decayedForm' | 'avgKillsPerMatch'
  const [sortDir, setSortDir] = useState('desc'); // default sort: most expensive / best first

  // Selection for CSV Export
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);

  useEffect(() => {
    async function loadPricingData() {
      try {
        setLoading(true);
        const [allPlayers, allTourneys] = await Promise.all([
          getPlayers(),
          getTournaments(),
        ]);

        const playerRegsPromises = allTourneys.map((t) => getPlayerRegistrations(t.id));
        const playerResPromises = allTourneys.map((t) => getPlayerMatchResults(t.id));

        const allPlayerRegs = await Promise.all(playerRegsPromises);
        const allPlayerRes = await Promise.all(playerResPromises);

        const playerMatchResultsByTournament = {};
        allTourneys.forEach((t, index) => {
          playerMatchResultsByTournament[t.id] = allPlayerRes[index] || [];
        });

        // 1. Build Career Aggregates per player
        const playerStatsMap = {};
        allPlayers.forEach((p) => {
          playerStatsMap[p.id] = {
            id: p.id,
            professionalName: p.professionalName || '',
            ign: p.ign || '',
            lastTeam: '—',
            totalKills: 0,
            totalMatches: 0,
          };
        });

        allTourneys.forEach((t, index) => {
          const tRegs = allPlayerRegs[index] || [];
          const tRes = allPlayerRes[index] || [];

          tRes.forEach((res) => {
            const pid = res.playerId;
            if (playerStatsMap[pid]) {
              playerStatsMap[pid].totalKills += res.kills || 0;
              playerStatsMap[pid].totalMatches += 1;
            }
          });

          tRegs.forEach((r) => {
            const pid = r.playerId;
            if (playerStatsMap[pid] && r.teamName) {
              playerStatsMap[pid].lastTeam = r.teamName;
            }
          });
        });

        // 2. Compute Player Global Forms
        const rawPlayerForms = allPlayers.map((p) => {
          const gf = computePlayerGlobalForm(p.id, allTourneys, playerMatchResultsByTournament);
          const meta = playerStatsMap[p.id] || {};
          const killsPerMatch = meta.totalMatches > 0
            ? Math.round((meta.totalKills / meta.totalMatches) * 100) / 100
            : 0;

          return {
            ...p,
            lastTeam: meta.lastTeam || '—',
            avgKillsPerMatch: killsPerMatch,
            globalForm: gf,
          };
        });

        // Compute field average form for status labels
        const rankedPlayerForms = rawPlayerForms.filter((p) => p.globalForm.confidence !== 'unranked');
        const fieldAvgPlayerForm = rankedPlayerForms.length > 0
          ? rankedPlayerForms.reduce((sum, p) => sum + (p.globalForm.decayedForm || 0), 0) / rankedPlayerForms.length
          : 0;

        // 3. Prepare pricing engine input & compute prices
        const pricingEngineInput = rawPlayerForms.map((p) => ({
          playerId: p.id,
          avgKillsPerMatch: p.avgKillsPerMatch,
          decayedForm: p.globalForm.decayedForm,
          rawForm: p.globalForm.rawForm,
          matchesUsed: p.globalForm.matchesUsed,
          confidence: p.globalForm.confidence,
        }));

        const costResults = computePlayerFantasyCost(pricingEngineInput);
        const costMap = {};
        costResults.forEach((cr) => {
          costMap[cr.playerId] = cr;
        });

        // 4. Assemble final priced list (strictly excluding unpriced / insufficient sample size players)
        const enriched = rawPlayerForms
          .map((p) => {
            const pricing = costMap[p.id] || {};
            const formLabel = globalFormLabel(
              p.globalForm.decayedForm,
              p.globalForm.trend,
              p.globalForm.confidence,
              fieldAvgPlayerForm
            );

            return {
              id: p.id,
              playerId: p.id,
              professionalName: p.professionalName || '',
              ign: p.ign || '',
              displayName: p.professionalName || p.ign || 'Unknown Player',
              lastTeam: p.lastTeam || '—',
              avgKillsPerMatch: p.avgKillsPerMatch,
              decayedForm: p.globalForm.decayedForm,
              rawForm: p.globalForm.rawForm,
              formLabel,
              confidence: p.globalForm.confidence,
              matchesUsed: p.globalForm.matchesUsed,
              cost: pricing.cost,
              blendedScore: pricing.blendedScore,
            };
          })
          .filter((p) => p.cost != null); // Clean reference list: only priced players

        setPlayersList(enriched);
      } catch (err) {
        console.error('Failed to load fantasy pricing data:', err);
        toast.error('Failed to load player pricing data');
      } finally {
        setLoading(false);
      }
    }

    loadPricingData();
  }, []);

  // Filtered by Search query
  const filteredPlayers = useMemo(() => {
    if (!search.trim()) return playersList;
    const q = search.toLowerCase().trim();
    return playersList.filter((p) => {
      const proName = (p.professionalName || '').toLowerCase();
      const ign = (p.ign || '').toLowerCase();
      const team = (p.lastTeam || '').toLowerCase();
      return proName.includes(q) || ign.includes(q) || team.includes(q);
    });
  }, [playersList, search]);

  // Sorted list
  const sortedPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];

      // Handle nulls
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;

      // Tie breaker secondary sorts
      let cmp = 0;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }

      if (cmp === 0) {
        // Default secondary tie-breaker: cost desc, then form desc, then kpm desc
        cmp = (b.cost || 0) - (a.cost || 0) || (b.decayedForm || 0) - (a.decayedForm || 0) || (b.avgKillsPerMatch || 0) - (a.avgKillsPerMatch || 0);
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredPlayers, sortKey, sortDir]);

  // Sort handler
  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'professionalName' || key === 'ign' || key === 'lastTeam' ? 'asc' : 'desc');
    }
  };

  const SortIcon = ({ accessor }) => {
    if (sortKey !== accessor) return <ArrowUpDown size={12} className="sort-icon-neutral" style={{ opacity: 0.4 }} />;
    return sortDir === 'asc' ? <ArrowUp size={12} className="sort-icon-active text-gold" /> : <ArrowDown size={12} className="sort-icon-active text-gold" />;
  };

  // CSV Export Handler
  const handleExportCSV = () => {
    const targets = selectedPlayerIds.length > 0
      ? sortedPlayers.filter((p) => selectedPlayerIds.includes(p.id))
      : sortedPlayers;

    if (targets.length === 0) {
      toast.error('No player pricing records available to export.');
      return;
    }

    const rows = targets.map((p, idx) => ({
      Rank: idx + 1,
      'Pro Name': p.professionalName || p.ign,
      IGN: p.ign,
      Team: p.lastTeam,
      'Cost (Credits)': p.cost,
      'Career KPM': p.avgKillsPerMatch,
      'Form Score': p.decayedForm ?? '—',
      'Form Label': p.formLabel || '—',
    }));

    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `br_fantasy_pricing_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${targets.length} player pricing records to CSV`);
  };

  const allVisibleSelected = sortedPlayers.length > 0 && selectedPlayerIds.length === sortedPlayers.length;

  return (
    <div>
      {/* Back link */}
      <div style={{ marginBottom: 14 }}>
        <Link
          href="/fantasy"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.82rem',
            color: 'var(--text-muted)',
            fontWeight: 600,
            textDecoration: 'none',
            transition: 'color 0.2s',
          }}
          className="hover:text-gold"
        >
          <ArrowLeft size={14} /> Back to BR Fantasy
        </Link>
      </div>

      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Coins size={24} style={{ color: 'var(--gold)' }} />
              BR Fantasy Player Pricing
            </h1>
            <p className="page-subtitle">
              Reference price sheet for competitive rosters based on career KPM and Global Form
            </p>
          </div>

          {/* Export Action */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={handleExportCSV}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}
              disabled={loading || sortedPlayers.length === 0}
            >
              <Download size={15} />
              <span>
                Export CSV {selectedPlayerIds.length > 0 ? `(${selectedPlayerIds.length})` : `(${sortedPlayers.length})`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary Stat Cards */}
      {!loading && playersList.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 20 }}>
          <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(201, 168, 76, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={20} style={{ color: 'var(--gold)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Priced Players</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{playersList.length}</div>
            </div>
          </div>

          <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(201, 168, 76, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Coins size={20} style={{ color: 'var(--gold)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Price Range</div>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>10 – 40 Credits</div>
            </div>
          </div>

          <div className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Shield size={20} style={{ color: 'var(--cyan)' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Formula Blend</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>60% KPM • 40% Form</div>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: Search + Selection Counter */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Search Box */}
          <div style={{ position: 'relative', minWidth: 260, flex: '1 1 280px' }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by Pro Name, IGN, or Team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input"
              style={{ paddingLeft: 36, width: '100%', fontSize: '0.85rem' }}
            />
          </div>

          {/* Selection indicator */}
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {selectedPlayerIds.length > 0 ? (
              <span style={{ color: 'var(--gold)', fontWeight: 600 }}>
                {selectedPlayerIds.length} of {sortedPlayers.length} selected
              </span>
            ) : (
              <span>Showing {sortedPlayers.length} players</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Table */}
      {loading ? (
        <div className="card" style={{ padding: 48, textAlign: 'center' }}>
          <LoadingSpinner />
          <div style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Calibrating career KPM and Global Form pricing...
          </div>
        </div>
      ) : sortedPlayers.length === 0 ? (
        <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
          {search ? 'No priced players match your search criteria.' : 'No eligible players with sufficient career data found.'}
        </div>
      ) : (
        <div className="data-table-container">
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {/* Select All Checkbox */}
                  <th style={{ width: 44, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedPlayerIds(sortedPlayers.map((p) => p.id));
                        } else {
                          setSelectedPlayerIds([]);
                        }
                      }}
                      style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
                      title="Select / Deselect All Filtered Players"
                    />
                  </th>

                  {/* Rank */}
                  <th style={{ width: 64 }}>RK</th>

                  {/* Pro Name */}
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('professionalName')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Pro Name</span>
                      <SortIcon accessor="professionalName" />
                    </div>
                  </th>

                  {/* IGN */}
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('ign')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>IGN</span>
                      <SortIcon accessor="ign" />
                    </div>
                  </th>

                  {/* Team */}
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('lastTeam')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Team</span>
                      <SortIcon accessor="lastTeam" />
                    </div>
                  </th>

                  {/* Cost (Credits) */}
                  <th
                    className="col-gold"
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('cost')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Cost (Credits)</span>
                      <SortIcon accessor="cost" />
                      <MetricTooltip metricKey="Cost" />
                    </div>
                  </th>

                  {/* Form */}
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('decayedForm')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Global Form</span>
                      <SortIcon accessor="decayedForm" />
                      <MetricTooltip metricKey="Global Form" />
                    </div>
                  </th>

                  {/* Career KPM */}
                  <th
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('avgKillsPerMatch')}
                  >
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span>Career KPM</span>
                      <SortIcon accessor="avgKillsPerMatch" />
                      <MetricTooltip metricKey="KPM" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((player, idx) => {
                  const isChecked = selectedPlayerIds.includes(player.id);
                  const isProNameSet = Boolean(player.professionalName);

                  return (
                    <tr
                      key={player.id}
                      style={{
                        background: isChecked ? 'rgba(201, 168, 76, 0.06)' : undefined,
                      }}
                    >
                      {/* Checkbox */}
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedPlayerIds((prev) => [...prev, player.id]);
                            } else {
                              setSelectedPlayerIds((prev) => prev.filter((id) => id !== player.id));
                            }
                          }}
                          style={{ accentColor: 'var(--gold)', cursor: 'pointer', width: 15, height: 15 }}
                        />
                      </td>

                      {/* Rank */}
                      <td>
                        <RankBadge rank={idx + 1} />
                      </td>

                      {/* Pro Name */}
                      <td style={{ fontWeight: 600 }}>
                        <Link
                          href={`/players/${player.id}`}
                          className="hover:text-gold transition"
                          style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                        >
                          {player.professionalName || player.ign}
                        </Link>
                      </td>

                      {/* IGN */}
                      <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                        {player.ign || '—'}
                      </td>

                      {/* Team */}
                      <td style={{ color: player.lastTeam !== '—' ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                        {player.lastTeam}
                      </td>

                      {/* Cost (Credits) */}
                      <td className="col-gold">
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 800,
                            fontSize: '0.95rem',
                            color: player.cost >= 35 ? 'var(--gold)' : player.cost >= 25 ? 'var(--cyan)' : 'var(--text-secondary)',
                            background: player.cost >= 35 ? 'rgba(201, 168, 76, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                            padding: '3px 9px',
                            borderRadius: 6,
                            border: `1px solid ${player.cost >= 35 ? 'rgba(201, 168, 76, 0.3)' : 'var(--border)'}`,
                          }}
                        >
                          <Coins size={13} />
                          {player.cost}
                        </span>
                      </td>

                      {/* Form */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                            {player.decayedForm != null ? player.decayedForm : '—'}
                          </span>
                          {player.formLabel && player.formLabel !== '—' && (
                            <span
                              className="badge"
                              style={{
                                fontSize: '0.68rem',
                                padding: '1px 6px',
                                background:
                                  player.formLabel === 'Red Hot'
                                    ? 'rgba(239, 68, 68, 0.15)'
                                    : player.formLabel === 'In Form'
                                    ? 'rgba(34, 197, 94, 0.15)'
                                    : player.formLabel === 'Cold'
                                    ? 'rgba(14, 165, 233, 0.15)'
                                    : 'var(--bg-alt-row)',
                                color:
                                  player.formLabel === 'Red Hot'
                                    ? 'var(--danger)'
                                    : player.formLabel === 'In Form'
                                    ? 'var(--success)'
                                    : player.formLabel === 'Cold'
                                    ? 'var(--cyan)'
                                    : 'var(--text-muted)',
                                border: '1px solid currentColor',
                              }}
                            >
                              {player.formLabel}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Career KPM */}
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {player.avgKillsPerMatch != null ? player.avgKillsPerMatch.toFixed(2) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
