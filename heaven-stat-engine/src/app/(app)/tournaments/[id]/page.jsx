'use client';
import { useTournament } from './layout';
import { useAuth } from '@/contexts/AuthContext';
import { StatusBadge, TierBadge } from '@/components/ui/Badge';
import { Calendar, Trophy, Crosshair, Award, Plus, Trash2, Edit, Check, Shield, Medal, X, Lock, UserCheck, UserX, UserPlus, AlertCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { setTournamentStatus, updateTournamentEditors } from '@/lib/firestore/tournaments';
import { getGroups, createGroup, updateGroup, deleteGroup } from '@/lib/firestore/groups';
import { auth } from '@/lib/firebase';
import toast from 'react-hot-toast';
import { useState, useEffect, useCallback } from 'react';
import { AVAILABLE_MAPS } from '@/lib/constants/maps';


const STATUS_FLOW = ['setup', 'active', 'completed', 'archived'];

export default function TournamentOverviewPage() {
  const { tournament, refresh } = useTournament();
  const { user, isOwner, isOperator } = useAuth();
  const router = useRouter();
  const [advancing, setAdvancing] = useState(false);

  const canEdit = isOwner || (tournament?.editorUids && (
    tournament.editorUids.includes(user?.uid) ||
    (user?.email && tournament.editorUids.some(e => e.toLowerCase() === user.email.toLowerCase()))
  ));

  // Access management state (Owner + tournament editors)
  const [newEditorInput, setNewEditorInput] = useState('');
  const [updatingEditors, setUpdatingEditors] = useState(false);

  const handleAddEditor = async () => {
    if (!newEditorInput.trim()) return;
    const cleanInput = newEditorInput.trim();
    setUpdatingEditors(true);
    try {
      let resolvedUid = cleanInput;
      let resolvedEmail = cleanInput.includes('@') ? cleanInput.toLowerCase() : null;

      // Lookup user if live Firebase
      try {
        const token = await auth?.currentUser?.getIdToken();
        if (token) {
          const res = await fetch(`/api/admin/lookup-uid?query=${encodeURIComponent(cleanInput)}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            if (data.uid) resolvedUid = data.uid;
            if (data.email) resolvedEmail = data.email;
          }
        }
      } catch (lookupErr) {
        console.warn('User lookup note:', lookupErr);
      }

      const currentEditors = tournament.editorUids || [];
      if (currentEditors.includes(resolvedUid)) {
        toast.error('This user already has editor access to this tournament');
        return;
      }

      const updated = [...currentEditors, resolvedUid];
      await updateTournamentEditors(tournament.id, updated);
      await refresh();
      setNewEditorInput('');

      // Send tournament invite email if live Firebase
      try {
        const token = await auth?.currentUser?.getIdToken();
        if (token) {
          await fetch('/api/admin/tournament-invite', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
              tournamentId: tournament.id,
              tournamentName: tournament.name,
              inviteeEmail: resolvedEmail,
              inviteeUid: resolvedUid,
            })
          });
        }
      } catch (inviteErr) {
        console.warn('Failed to dispatch tournament invite email:', inviteErr);
      }

      toast.success(`Access granted! Invite dispatched.`);
    } catch (err) {
      toast.error('Failed to grant access: ' + err.message);
    } finally {
      setUpdatingEditors(false);
    }
  };

  const handleRemoveEditor = async (uidToRemove) => {
    setUpdatingEditors(true);
    try {
      const updated = (tournament.editorUids || []).filter(u => u !== uidToRemove);
      await updateTournamentEditors(tournament.id, updated);
      await refresh();
      toast.success('Access revoked');
    } catch (err) {
      toast.error('Failed to revoke access: ' + err.message);
    } finally {
      setUpdatingEditors(false);
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
    if (!canEdit) { toast.error('Edit permission required'); return; }
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
    if (!canEdit) { toast.error('Edit permission required'); return; }
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
    if (!canEdit) { toast.error('Edit permission required'); return; }
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
    if (!canEdit) { toast.error('Edit permission required'); return; }
    try {
      await updateGroup(tournament.id, groupId, { status: newStatus });
      toast.success(`Group status updated to ${newStatus}`);
      await loadGroupsList();
    } catch (err) {
      toast.error('Failed to update group status: ' + err.message);
    }
  };

  const handleDeleteGroup = async (groupId, name) => {
    if (!isOwner) { toast.error('Only the owner can delete groups'); return; }
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
      {/* Read-Only Notice for Operators without edit access */}
      {isOperator && !canEdit && (
        <div style={{
          padding: '14px 18px',
          borderRadius: 10,
          background: 'rgba(59, 130, 246, 0.08)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: '#93c5fd'
        }}>
          <Lock size={18} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div>
            <strong style={{ color: '#fff' }}>Read-Only View:</strong> You have view-only access to this tournament. Contact the owner to request editor permissions for data entry.
          </div>
        </div>
      )}

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

      {/* ── Collaborator & Operator Access Management ─────────────────────────────── */}
      {canEdit && (
        <div className="card" style={{ marginBottom: 24, border: '1px solid rgba(201,168,76,0.3)' }}>
          <div className="flex-between" style={{ marginBottom: 14 }}>
            <div>
              <h3 className="card-title flex items-center gap-2" style={{ color: 'var(--gold)' }}>
                <UserCheck size={18} />
                {isOwner ? 'Operator Access Management' : 'Collaborator Access Management'}
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Grant or revoke collaborator editor access for this specific tournament.
              </p>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'var(--bg-alt-row)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)' }}>
              {(tournament.editorUids || []).length} Editor{(tournament.editorUids || []).length !== 1 ? 's' : ''} Assigned
            </span>
          </div>

          {/* Current editors list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {(!tournament.editorUids || tournament.editorUids.length === 0) ? (
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic', margin: 0 }}>
                No collaborator editors assigned yet.
              </p>
            ) : (
              tournament.editorUids.map(uid => (
                <div key={uid} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--bg-alt-row)',
                  borderRadius: 8,
                  border: '1px solid var(--border-md)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 700 }}>Editor UID:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                      {uid}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', padding: '3px 8px', fontSize: '0.78rem' }}
                    onClick={() => handleRemoveEditor(uid)}
                    disabled={updatingEditors}
                    title="Revoke collaborator access"
                  >
                    <UserX size={13} /> Revoke
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Add operator / collaborator form */}
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              className="form-input"
              placeholder="Enter collaborator email or user UID..."
              value={newEditorInput}
              onChange={e => setNewEditorInput(e.target.value)}
              style={{ flex: 1, fontSize: '0.85rem' }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleAddEditor}
              disabled={updatingEditors || !newEditorInput.trim()}
            >
              <UserPlus size={14} /> Grant Access
            </button>
          </div>
        </div>
      )}

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
            {canEdit && (
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
            )}
          </div>

          {/* Add Group inline form */}
          {canEdit && showAddGroup && (
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
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Default Map:</span>
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

          {/* Groups List */}
          {loadingGroups ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading qualifier groups...</p>
          ) : groups.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No groups found. Add a group above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groups.map((g) => {
                const isEditingThis = editingGroupId === g.id;
                return (
                  <div
                    key={g.id}
                    style={{
                      background: 'var(--bg-alt-row)',
                      border: '1px solid var(--border-md)',
                      borderRadius: 8,
                      padding: 14,
                    }}
                  >
                    <div className="flex-between" style={{ marginBottom: isEditingThis ? 12 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                          {g.groupName}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {g.structure?.totalDays || 6} Days · {g.structure?.lobbiesPerDay || 4} Lobbies/Day
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 600 }}>
                          Top {g.advancementCount || 2} Advance
                        </span>
                        <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)' }}>
                          Map: {g.mapConfig?.mode === 'flexible' ? 'Flexible' : (g.mapConfig?.map || 'Isolated')}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {canEdit && (
                          <select
                            className="form-select"
                            style={{ fontSize: '0.78rem', padding: '4px 8px' }}
                            value={g.status || 'setup'}
                            onChange={(e) => handleGroupStatusChange(g.id, e.target.value)}
                          >
                            <option value="setup">Setup</option>
                            <option value="active">Active</option>
                            <option value="completed">Completed</option>
                            <option value="archived">Archived</option>
                          </select>
                        )}
                        {canEdit && (
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
                        )}
                        {isOwner && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ padding: '6px', color: 'var(--danger)' }}
                            onClick={() => handleDeleteGroup(g.id, g.groupName)}
                            title="Delete group"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditingThis && editingGroupData && canEdit && (
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

      {/* Ranked event status — compact info card. Full controls moved to Config page */}
      {tournament.isRanked && (
        <div className="card" style={{ marginBottom: 20, border: '1px solid rgba(201,168,76,0.45)', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#b8860b,#d4a017)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Medal size={18} style={{ color: '#fff' }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 8 }}>
              Ranked Event <TierBadge tier={tournament.rankedTier} />
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
              Tier labels applied to all registered teams & players
            </div>
          </div>
          {isOwner && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => router.push(`/tournaments/${tournament.id}/config`)}
              style={{ flexShrink: 0 }}
            >
              <Edit size={13} style={{ marginRight: 4 }} /> Manage in Config
            </button>
          )}
        </div>
      )}

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
          {canEdit && currentIdx < STATUS_FLOW.length - 1 && (
            <button className="btn btn-primary" onClick={handleAdvance} disabled={advancing}>
              {advancing ? 'Advancing...' : `Advance to ${STATUS_FLOW[currentIdx + 1]}`}
            </button>
          )}
          {isOwner && (
            <button className="btn btn-secondary" onClick={() => router.push(`/tournaments/${tournament.id}/config`)}>
              {tournament.status === 'setup' ? 'Edit Configuration' : 'View Configuration'}
            </button>
          )}
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
