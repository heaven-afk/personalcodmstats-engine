'use client';
import { useTournament } from './layout';
import { StatusBadge, TierBadge } from '@/components/ui/Badge';
import { Calendar, Trophy, Crosshair, Award, Plus, Trash2, Edit, Check, Shield, Medal, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { setTournamentStatus } from '@/lib/firestore/tournaments';
import { rankEvent } from '@/lib/firestore/rankEvent';
import { getGroups, createGroup, updateGroup, deleteGroup } from '@/lib/firestore/groups';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';

const TIER_OPTIONS = ['Tier 1', 'Tier 2', 'Tier 3'];

const STATUS_FLOW = ['setup', 'active', 'completed', 'archived'];

export default function TournamentOverviewPage() {
  const { tournament, refresh } = useTournament();
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);

  // Ranked event state
  const [showRankPanel, setShowRankPanel]     = useState(false);
  const [selectedTier, setSelectedTier]       = useState(tournament?.rankedTier || 'Tier 1');
  const [rankingInProgress, setRankingInProgress] = useState(false);

  const handleRankEvent = async (isRanked) => {
    if (isRanked && !selectedTier) { toast.error('Please select a tier.'); return; }
    setRankingInProgress(true);
    try {
      const result = await rankEvent(tournament.id, isRanked, selectedTier);
      toast.success(
        isRanked
          ? `✅ Tournament ranked as ${selectedTier}! ${result.teamsUpdated} teams & ${result.playersUpdated} players updated.`
          : `Ranking removed. ${result.teamsUpdated} teams & ${result.playersUpdated} players recalculated.`
      );
      setShowRankPanel(false);
      await refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRankingInProgress(false);
    }
  };

  // Qualifier groups state
  const [groups, setGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(tournament?.type === 'qualifier');
  const [showAddGroup, setShowAddGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({
    groupName: '',
    structure: { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
    mapConfig: { mode: 'rigid', map: AVAILABLE_MAPS[0], schedule: {} },
    advancementCount: 2,
    status: 'setup',
  });
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [editingGroupData, setEditingGroupData] = useState(null);

  const loadGroupsList = useCallback(async () => {
    if (tournament?.type !== 'qualifier') return;
    try {
      const g = await getGroups(tournament.id);
      setGroups(g);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setLoadingGroups(false);
    }
  }, [tournament?.id, tournament?.type]);

  useEffect(() => {
    loadGroupsList();
  }, [loadGroupsList]);

  const { structure = {}, scoring = {} } = tournament;
  const currentIdx = STATUS_FLOW.indexOf(tournament.status);

  const handleAdvance = async () => {
    const next = STATUS_FLOW[currentIdx + 1];
    if (!next) return;
    if (!confirm(`Advance tournament to "${next}"?${next === 'active' ? '\nThis will lock structure and scoring config.' : ''}`)) return;
    setAdvancing(true);
    try {
      await setTournamentStatus(tournament.id, next);
      await refresh();
      toast.success(`Status → ${next}`);
    } catch (e) { toast.error(e.message); }
    finally { setAdvancing(false); }
  };

  const handleAddGroup = async () => {
    if (!newGroup.groupName.trim()) {
      toast.error('Group name is required');
      return;
    }
    try {
      await createGroup(tournament.id, {
        ...newGroup,
        groupName: newGroup.groupName.trim(),
      });
      toast.success(`Created group "${newGroup.groupName}"`);
      setShowAddGroup(false);
      setNewGroup({
        groupName: '',
        structure: { totalDays: 6, lobbiesPerDay: 4, playerClasses: [] },
        mapConfig: { mode: 'rigid', map: AVAILABLE_MAPS[0], schedule: {} },
        advancementCount: 2,
        status: 'setup',
      });
      await loadGroupsList();
    } catch (err) {
      toast.error('Failed to create group: ' + err.message);
    }
  };

  const handleSaveGroupEdit = async (groupId) => {
    if (!editingGroupData) return;
    try {
      await updateGroup(tournament.id, groupId, editingGroupData);
      toast.success('Group updated successfully');
      setEditingGroupId(null);
      setEditingGroupData(null);
      await loadGroupsList();
    } catch (err) {
      toast.error('Failed to update group: ' + err.message);
    }
  };

  const handleGroupStatusChange = async (groupId, newStatus) => {
    try {
      await updateGroup(tournament.id, groupId, { status: newStatus });
      toast.success(`Group status updated to ${newStatus}`);
      await loadGroupsList();
    } catch (err) {
      toast.error('Failed to update group status: ' + err.message);
    }
  };

  const handleDeleteGroup = async (groupId, name) => {
    if (!confirm(`Delete group "${name}"?`)) return;
    try {
      await deleteGroup(tournament.id, groupId);
      toast.success(`Group "${name}" deleted`);
      await loadGroupsList();
    } catch (err) {
      toast.error('Failed to delete group: ' + err.message);
    }
  };

  return (
    <div>
      {/* Quick stats */}
      <div className="card-grid" style={{ marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-card-icon gold"><Calendar size={20} /></div>
          <div>
            <div className="stat-card-value">
              {tournament.type === 'qualifier' ? groups.length : (structure.totalDays || 0)}
            </div>
            <div className="stat-card-label">
              {tournament.type === 'qualifier' ? 'Groups' : 'Total Days'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon cyan"><Trophy size={20} /></div>
          <div>
            <div className="stat-card-value">
              {tournament.type === 'qualifier' ? 'Qualifier' : (structure.lobbiesPerDay || 0)}
            </div>
            <div className="stat-card-label">
              {tournament.type === 'qualifier' ? 'Tournament Type' : 'Lobbies / Day'}
            </div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon red"><Crosshair size={20} /></div>
          <div><div className="stat-card-value">{scoring.killPointValue || 0}</div><div className="stat-card-label">Points / Kill</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-card-icon blue"><Award size={20} /></div>
          <div><div className="stat-card-value">{scoring.placementPoints?.length || 0}</div><div className="stat-card-label">Placement Tiers</div></div>
        </div>
      </div>

      {/* Qualifier Groups Management section if type === 'qualifier' */}
      {tournament.type === 'qualifier' && (
        <div className="card" style={{ marginBottom: 24 }}>
          <div className="flex-between" style={{ marginBottom: 16 }}>
            <div>
              <h3 className="card-title">Qualifier Groups Subcollection</h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
                Each group runs its own schedule and advances top teams.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => {
                const nextChar = String.fromCharCode(65 + groups.length);
                setNewGroup(prev => ({ ...prev, groupName: `Group ${nextChar}` }));
                setShowAddGroup(v => !v);
              }}
            >
              <Plus size={14} /> Add Group
            </button>
          </div>

          {/* Add Group inline form */}
          {showAddGroup && (
            <div style={{ background: 'var(--bg-alt-row)', border: '1px solid var(--gold)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>New Group Configuration</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Group Name</label>
                  <input
                    className="form-input"
                    value={newGroup.groupName}
                    onChange={e => setNewGroup(g => ({ ...g, groupName: e.target.value }))}
                    placeholder="e.g. Group A"
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Total Days</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1} max={14}
                    value={newGroup.structure.totalDays}
                    onChange={e => setNewGroup(g => ({ ...g, structure: { ...g.structure, totalDays: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Lobbies / Day</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1} max={10}
                    value={newGroup.structure.lobbiesPerDay}
                    onChange={e => setNewGroup(g => ({ ...g, structure: { ...g.structure, lobbiesPerDay: Number(e.target.value) } }))}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Advancement Count</label>
                  <input
                    className="form-input"
                    type="number"
                    min={1} max={50}
                    value={newGroup.advancementCount}
                    onChange={e => setNewGroup(g => ({ ...g, advancementCount: Number(e.target.value) }))}
                  />
                </div>
              </div>

              {/* Map Config Section */}
              <div style={{ background: 'rgba(0,0,0,0.15)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <label className="form-label" style={{ fontSize: '0.75rem', marginBottom: 6, display: 'block' }}>Group Map Mode</label>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="newGroupMapMode"
                      value="rigid"
                      checked={(newGroup.mapConfig?.mode || 'rigid') === 'rigid'}
                      onChange={() => setNewGroup(g => ({ ...g, mapConfig: { ...g.mapConfig, mode: 'rigid' } }))}
                    />
                    Rigid
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="newGroupMapMode"
                      value="flexible"
                      checked={newGroup.mapConfig?.mode === 'flexible'}
                      onChange={() => setNewGroup(g => ({ ...g, mapConfig: { ...g.mapConfig, mode: 'flexible' } }))}
                    />
                    Flexible
                  </label>

                  {(newGroup.mapConfig?.mode || 'rigid') === 'rigid' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Map:</span>
                      <select
                        className="form-select"
                        style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                        value={newGroup.mapConfig?.map || AVAILABLE_MAPS[0]}
                        onChange={e => setNewGroup(g => ({ ...g, mapConfig: { ...g.mapConfig, map: e.target.value } }))}
                      >
                        {AVAILABLE_MAPS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddGroup(false)}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleAddGroup}>Save Group</button>
              </div>
            </div>
          )}

          {groups.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No groups defined yet. Click "Add Group" to create one.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {groups.map(g => {
                const isEditingThis = editingGroupId === g.id;
                return (
                  <div
                    key={g.id}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      padding: '14px 18px',
                      background: 'var(--bg-alt-row)',
                      border: '1px solid var(--border-md)',
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gold)' }}>{g.groupName}</span>
                          <StatusBadge status={g.status || 'setup'} />
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          Days: {g.structure?.totalDays || 6} · Lobbies: {g.structure?.lobbiesPerDay || 4} · Advances: Top {g.advancementCount || 2} teams
                          {' · '}
                          Map: {g.mapConfig?.mode === 'flexible' ? 'Flexible' : `Rigid (${g.mapConfig?.map || 'Isolated'})`}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <select
                          className="form-select"
                          style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                          value={g.status || 'setup'}
                          onChange={e => handleGroupStatusChange(g.id, e.target.value)}
                        >
                          <option value="setup">Setup</option>
                          <option value="active">Active</option>
                          <option value="completed">Completed</option>
                        </select>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '6px 10px', fontSize: '0.78rem' }}
                          onClick={() => {
                            if (isEditingThis) {
                              setEditingGroupId(null);
                              setEditingGroupData(null);
                            } else {
                              setEditingGroupId(g.id);
                              setEditingGroupData({
                                groupName: g.groupName,
                                structure: g.structure || { totalDays: 6, lobbiesPerDay: 4 },
                                mapConfig: g.mapConfig || { mode: 'rigid', map: AVAILABLE_MAPS[0], schedule: {} },
                                advancementCount: g.advancementCount || 2,
                              });
                            }
                          }}
                        >
                          {isEditingThis ? 'Cancel' : 'Edit Map'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '6px', color: 'var(--danger)' }}
                          onClick={() => handleDeleteGroup(g.id, g.groupName)}
                          title="Delete group"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>

                    {isEditingThis && editingGroupData && (
                      <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: 12, marginTop: 4 }}>
                        <h5 style={{ fontSize: '0.8rem', color: 'var(--gold)', marginBottom: 8, fontWeight: 700 }}>Edit Group Map Config</h5>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name={`editMapMode_${g.id}`}
                              value="rigid"
                              checked={(editingGroupData.mapConfig?.mode || 'rigid') === 'rigid'}
                              onChange={() => setEditingGroupData(eg => ({
                                ...eg,
                                mapConfig: { ...(eg.mapConfig || {}), mode: 'rigid' }
                              }))}
                            />
                            Rigid
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name={`editMapMode_${g.id}`}
                              value="flexible"
                              checked={editingGroupData.mapConfig?.mode === 'flexible'}
                              onChange={() => setEditingGroupData(eg => ({
                                ...eg,
                                mapConfig: { ...(eg.mapConfig || {}), mode: 'flexible' }
                              }))}
                            />
                            Flexible
                          </label>

                          {(editingGroupData.mapConfig?.mode || 'rigid') === 'rigid' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Map:</span>
                              <select
                                className="form-select"
                                style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                                value={editingGroupData.mapConfig?.map || AVAILABLE_MAPS[0]}
                                onChange={e => setEditingGroupData(eg => ({
                                  ...eg,
                                  mapConfig: { ...(eg.mapConfig || {}), map: e.target.value }
                                }))}
                              >
                                {AVAILABLE_MAPS.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                          )}
                        </div>

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => handleSaveGroupEdit(g.id)}
                          >
                            Save Group Map Config
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Ranked Event Card ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 20, border: tournament.isRanked ? '1px solid rgba(201,168,76,0.45)' : '1px solid var(--border-md)', position: 'relative', overflow: 'hidden' }}>
        {tournament.isRanked && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #b8860b, #C9A84C, #d4a017)' }} />
        )}
        <div className="flex-between" style={{ marginBottom: showRankPanel ? 16 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: tournament.isRanked ? 'linear-gradient(135deg,#b8860b,#d4a017)' : 'var(--bg-alt-row)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Medal size={18} style={{ color: tournament.isRanked ? '#fff' : 'var(--text-muted)' }} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h3 className="card-title" style={{ margin: 0 }}>Ranked Event Status</h3>
                {tournament.isRanked && <TierBadge tier={tournament.rankedTier} />}
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, marginTop: 2 }}>
                {tournament.isRanked
                  ? `This event is ranked. Teams & players have been labelled ${tournament.rankedTier}.`
                  : 'Mark this event as ranked to apply tier labels to all participants.'}
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {tournament.isRanked && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)', fontSize: '0.78rem' }}
                onClick={() => { setSelectedTier(tournament.rankedTier || 'Tier 1'); setShowRankPanel(v => !v); }}
                disabled={rankingInProgress}
              >
                <Edit size={13} /> Edit Tier
              </button>
            )}
            {tournament.isRanked && !showRankPanel && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--danger)', fontSize: '0.78rem' }}
                onClick={() => { if (confirm('Remove ranking from this tournament? Tier labels will be recalculated.')) handleRankEvent(false); }}
                disabled={rankingInProgress}
              >
                {rankingInProgress ? 'Processing…' : <><X size={13} /> Remove Ranking</>}
              </button>
            )}
            {!tournament.isRanked && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: 'linear-gradient(135deg,#b8860b,#C9A84C)', border: 'none' }}
                onClick={() => { setSelectedTier('Tier 1'); setShowRankPanel(v => !v); }}
                disabled={rankingInProgress}
              >
                <Medal size={13} /> Mark as Ranked
              </button>
            )}
          </div>
        </div>

        {/* Tier selection panel */}
        {showRankPanel && (
          <div style={{ background: 'rgba(0,0,0,0.18)', borderRadius: 10, padding: '16px 20px', border: '1px solid rgba(201,168,76,0.25)' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', marginBottom: 12 }}>Select Tier</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
              {TIER_OPTIONS.map(t => {
                const cfg = {
                  'Tier 1': { icon: '🏅', desc: 'Top-level championship', color: '#C9A84C' },
                  'Tier 2': { icon: '🥈', desc: 'High-level competitive', color: '#9ca3af' },
                  'Tier 3': { icon: '🥉', desc: 'Competitive league', color: '#b45309' },
                }[t];
                const isSelected = selectedTier === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setSelectedTier(t)}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '12px 20px', borderRadius: 10, cursor: 'pointer',
                      background: isSelected ? `${cfg.color}22` : 'var(--bg-card)',
                      border: `2px solid ${isSelected ? cfg.color : 'var(--border-md)'}`,
                      transition: 'all 0.15s', minWidth: 110,
                    }}
                  >
                    <span style={{ fontSize: '1.5rem' }}>{cfg.icon}</span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 800, color: isSelected ? cfg.color : 'var(--text-primary)' }}>{t}</span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{cfg.desc}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowRankPanel(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ background: 'linear-gradient(135deg,#b8860b,#C9A84C)', border: 'none' }}
                disabled={rankingInProgress}
                onClick={() => handleRankEvent(true)}
              >
                {rankingInProgress ? 'Processing…' : `Confirm — ${selectedTier}`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Status stepper */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="flex-between" style={{ marginBottom: 16 }}>
          <h3 className="card-title">Tournament Status</h3>
          <StatusBadge status={tournament.status} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 20, flexWrap: 'wrap', rowGap: 8 }}>
          {STATUS_FLOW.map((s, i) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 99,
                background: i < currentIdx ? 'rgba(201,168,76,0.15)' : i === currentIdx ? 'rgba(201,168,76,0.25)' : 'var(--bg-alt-row)',
                border: `1px solid ${i <= currentIdx ? 'rgba(201,168,76,0.4)' : 'var(--border)'}`,
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.7rem', fontWeight: 700,
                  background: i <= currentIdx ? 'var(--gold)' : 'var(--bg-header)',
                  color: i <= currentIdx ? '#000' : 'var(--text-muted)',
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: '0.8rem', fontWeight: i === currentIdx ? 700 : 400, color: i === currentIdx ? 'var(--gold)' : i < currentIdx ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </span>
              </div>
              {i < STATUS_FLOW.length - 1 && <div style={{ width: 24, height: 2, background: i < currentIdx ? 'var(--gold)' : 'var(--border)' }} />}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          {currentIdx < STATUS_FLOW.length - 1 && (
            <button className="btn btn-primary" onClick={handleAdvance} disabled={advancing}>
              {advancing ? 'Advancing...' : `Advance to ${STATUS_FLOW[currentIdx + 1]}`}
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => router.push(`/tournaments/${tournament.id}/config`)}>
            {tournament.status === 'setup' ? 'Edit Configuration' : 'View Configuration'}
          </button>
        </div>
      </div>

      <div className="card-grid">
        {/* Placement Points */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 14 }}>Placement Points</h3>
          {scoring.placementPoints?.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 6 }}>
              {scoring.placementPoints.map((pp) => (
                <div key={pp.position} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--bg-alt-row)', borderRadius: 6, fontSize: '0.82rem' }}>
                  <span style={{ color: 'var(--text-muted)' }}>#{pp.position}</span>
                  <span style={{ fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>{pp.points}</span>
                </div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No placement points configured</p>}
        </div>

        {/* Player Classes (Standard tournaments) */}
        {tournament.type !== 'qualifier' && (
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Player Classes</h3>
            {structure.playerClasses?.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {structure.playerClasses.map((cls, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: 'var(--bg-alt-row)', borderRadius: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: cls.badgeColor || '#C9A84C', display: 'inline-block' }} />
                      <span style={{ fontWeight: 600 }}>{cls.className}</span>
                    </span>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Days: {cls.activeDays?.join(', ') || 'All'}</span>
                  </div>
                ))}
              </div>
            ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No classes defined</p>}
          </div>
        )}

        {/* Bonus Types */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 14 }}>Bonus / Penalty Types</h3>
          {scoring.bonusTypes?.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {scoring.bonusTypes.map((bt, i) => (
                <div key={i} style={{ padding: '9px 14px', background: 'var(--bg-alt-row)', borderRadius: 8, fontWeight: 500, fontSize: '0.875rem' }}>{bt.name}</div>
              ))}
            </div>
          ) : <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No bonus types defined</p>}
        </div>
      </div>
    </div>
  );
}
