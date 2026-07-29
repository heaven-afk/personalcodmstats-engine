'use client';
import { useState, useEffect, useCallback } from 'react';
import { useTournament } from '../layout';
import {
  getTeamMatchResults, deleteTeamMatchResult,
  getPlayerMatchResults, deletePlayerMatchResult
} from '@/lib/firestore/matchData';
import { getTeamRegistrations, getPlayerRegistrations } from '@/lib/firestore/tournaments';
import { getGroups } from '@/lib/firestore/groups';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { AlertTriangle, CheckCircle, Trash2, ShieldAlert, Users, User } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CleanDuplicatesPage() {
  const { tournament } = useTournament();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [registeredNames, setRegisteredNames] = useState(new Set());
  
  // Group & Mode State
  const [groups, setGroups] = useState([]);
  const [selectedGroupId, setSelectedGroupId] = useState('all'); // 'all' or specific groupId
  const [scanType, setScanType] = useState('team'); // 'team' | 'player'

  // Load registrations, groups, and match results to identify duplicates
  const scanForDuplicates = useCallback(async () => {
    if (!tournament?.id) return;
    setScanning(true);
    try {
      // 1. Fetch groups list
      const gList = await getGroups(tournament.id);
      setGroups(gList);

      const groupMap = (gList || []).reduce((acc, g) => {
        acc[g.id] = g.groupName;
        return acc;
      }, {});

      if (scanType === 'team') {
        // --- TEAM DUPLICATES SCAN ---
        const teamRegs = await getTeamRegistrations(tournament.id);
        const names = new Set(teamRegs.map(r => r.teamName?.trim().toLowerCase()).filter(Boolean));
        setRegisteredNames(names);

        let tr = await getTeamMatchResults(tournament.id);

        // Filter by group if selected
        if (selectedGroupId && selectedGroupId !== 'all') {
          tr = tr.filter(doc => doc.groupId === selectedGroupId);
        }

        // Group results by group, day, lobby, and normalized teamName
        const itemGroups = {};
        tr.forEach((doc) => {
          const normalizedName = (doc.teamName || '').trim().toLowerCase();
          if (!normalizedName) return;

          // Group-aware key incorporates groupId
          const groupKey = doc.groupId ? `grp_${doc.groupId}` : 'nogroup';
          const key = `${groupKey}_D${doc.day}_L${doc.lobby}_${normalizedName}`;

          if (!itemGroups[key]) itemGroups[key] = [];
          itemGroups[key].push({
            ...doc,
            groupName: doc.groupId ? groupMap[doc.groupId] || doc.groupId : 'General'
          });
        });

        // Find duplicates
        const dupList = [];
        for (const [key, list] of Object.entries(itemGroups)) {
          if (list.length > 1) {
            // Determine best entry to keep:
            // 1. Matched registered team name
            // 2. Has teamId
            // 3. Highest kills / placement
            let keepIndex = -1;
            let bestScore = -1;

            list.forEach((item, idx) => {
              let score = 0;
              const normName = (item.teamName || '').trim().toLowerCase();
              if (names.has(normName)) score += 50;
              if (item.teamId) score += 30;
              if (item.placement > 0) score += 10;
              if (item.kills > 0) score += Math.min(item.kills, 10);

              if (score > bestScore) {
                bestScore = score;
                keepIndex = idx;
              }
            });

            if (keepIndex === -1) keepIndex = 0;

            const toKeep = list[keepIndex];
            const toDelete = list.filter((_, idx) => idx !== keepIndex);

            dupList.push({
              key,
              groupName: toKeep.groupName,
              day: toKeep.day,
              lobby: toKeep.lobby,
              name: toKeep.teamName?.trim(),
              toKeep,
              toDelete,
            });
          }
        }
        setDuplicates(dupList);

      } else {
        // --- PLAYER DUPLICATES SCAN ---
        const playerRegs = await getPlayerRegistrations(tournament.id);
        const playerNames = new Set(playerRegs.map(r => (r.professionalName || r.ign || '').trim().toLowerCase()).filter(Boolean));
        setRegisteredNames(playerNames);

        let pr = await getPlayerMatchResults(tournament.id);

        if (selectedGroupId && selectedGroupId !== 'all') {
          pr = pr.filter(doc => doc.groupId === selectedGroupId);
        }

        const itemGroups = {};
        pr.forEach((doc) => {
          const normName = (doc.playerName || doc.ign || '').trim().toLowerCase();
          if (!normName) return;

          const groupKey = doc.groupId ? `grp_${doc.groupId}` : 'nogroup';
          const playerKey = doc.playerId ? `pid_${doc.playerId}` : `pname_${normName}`;
          const key = `${groupKey}_D${doc.day}_L${doc.lobby}_${playerKey}`;

          if (!itemGroups[key]) itemGroups[key] = [];
          itemGroups[key].push({
            ...doc,
            groupName: doc.groupId ? groupMap[doc.groupId] || doc.groupId : 'General'
          });
        });

        const dupList = [];
        for (const [key, list] of Object.entries(itemGroups)) {
          if (list.length > 1) {
            let keepIndex = -1;
            let bestScore = -1;

            list.forEach((item, idx) => {
              let score = 0;
              if (item.playerId) score += 50;
              if (item.kills !== null && item.kills !== undefined) score += 20;
              if (item.damage !== null && item.damage !== undefined) score += 10;
              if (score > bestScore) {
                bestScore = score;
                keepIndex = idx;
              }
            });

            if (keepIndex === -1) keepIndex = 0;

            const toKeep = list[keepIndex];
            const toDelete = list.filter((_, idx) => idx !== keepIndex);

            dupList.push({
              key,
              groupName: toKeep.groupName,
              day: toKeep.day,
              lobby: toKeep.lobby,
              name: toKeep.playerName || toKeep.ign,
              toKeep,
              toDelete,
            });
          }
        }
        setDuplicates(dupList);
      }
    } catch (e) {
      toast.error('Error scanning for duplicates: ' + e.message);
    } finally {
      setScanning(false);
      setLoading(false);
    }
  }, [tournament?.id, scanType, selectedGroupId]);

  useEffect(() => {
    scanForDuplicates();
  }, [scanForDuplicates]);

  const handleDeleteDuplicates = async () => {
    if (duplicates.length === 0) return;
    const count = duplicates.reduce((acc, d) => acc + d.toDelete.length, 0);
    if (!confirm(`Are you sure you want to delete all ${count} duplicate ${scanType} match result entries? This action cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    let deletedCount = 0;
    try {
      for (const dup of duplicates) {
        for (const item of dup.toDelete) {
          if (scanType === 'team') {
            await deleteTeamMatchResult(tournament.id, item.id);
          } else {
            await deletePlayerMatchResult(tournament.id, item.id);
          }
          deletedCount++;
        }
      }
      toast.success(`Successfully deleted ${deletedCount} duplicate ${scanType} match result(s).`);
      await scanForDuplicates();
    } catch (e) {
      toast.error('Error deleting duplicates: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" text="Scanning database for duplicates..." />;
  }

  const totalDeleteCount = duplicates.reduce((acc, d) => acc + d.toDelete.length, 0);

  return (
    <div style={{ maxWidth: 1050, margin: '0 auto', padding: '20px 0' }}>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.4rem' }}>
              <ShieldAlert className="text-gold" />
              Clean Duplicate Match Results
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: 6, lineHeight: 1.5 }}>
              Scan match result records grouped by group, day, and lobby to safely identify and remove duplicate document entries.
            </p>
          </div>

          {/* Mode Switcher */}
          <div style={{ display: 'flex', gap: 6, background: 'var(--bg-alt-row)', padding: 4, borderRadius: 8, border: '1px solid var(--border-md)' }}>
            <button
              type="button"
              onClick={() => { setScanType('team'); setDuplicates([]); }}
              className={`btn btn-sm ${scanType === 'team' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Users size={14} /> Team Duplicates
            </button>
            <button
              type="button"
              onClick={() => { setScanType('player'); setDuplicates([]); }}
              className={`btn btn-sm ${scanType === 'player' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <User size={14} /> Player Duplicates
            </button>
          </div>
        </div>

        {/* Group Selector Filter */}
        {groups.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--gold)' }}>Filter Group:</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedGroupId('all')}
                className={`btn btn-sm ${selectedGroupId === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontWeight: selectedGroupId === 'all' ? 700 : 500 }}
              >
                All Groups ({groups.length})
              </button>
              {groups.map(g => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedGroupId(g.id)}
                  className={`btn btn-sm ${selectedGroupId === g.id ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ fontWeight: selectedGroupId === g.id ? 700 : 500 }}
                >
                  {g.groupName}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {duplicates.length === 0 ? (
        <div className="card" style={{
          background: 'rgba(16, 185, 129, 0.05)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: 8,
          padding: '32px 16px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12
        }}>
          <CheckCircle size={44} style={{ color: 'rgb(16, 185, 129)' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'rgb(16, 185, 129)' }}>Your database is clean!</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 520, lineHeight: 1.5 }}>
            No duplicate {scanType} match result entries (same {scanType}, group, day, and lobby) were found for this selection.
          </p>
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={scanForDuplicates} 
            disabled={scanning}
            style={{ marginTop: 8 }}
          >
            {scanning ? 'Scanning...' : 'Scan Again'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card" style={{
            background: 'rgba(239, 68, 68, 0.05)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            borderRadius: 8,
            padding: 16,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AlertTriangle size={32} style={{ color: 'rgb(239, 68, 68)' }} />
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600 }}>Action Required: Duplicates Detected</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 4 }}>
                  Found <strong>{duplicates.length}</strong> unique duplicate instances (<strong>{totalDeleteCount}</strong> duplicate records to remove).
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={scanForDuplicates} 
                disabled={scanning || deleting}
              >
                {scanning ? 'Scanning...' : 'Rescan'}
              </button>
              <button 
                className="btn btn-primary btn-sm" 
                onClick={handleDeleteDuplicates} 
                disabled={deleting || scanning}
                style={{ background: 'var(--red)', borderColor: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={15} />
                {deleting ? 'Deleting...' : `Delete ${totalDeleteCount} Duplicates`}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">Duplicate Analysis Table ({scanType === 'team' ? 'Teams' : 'Players'})</h3>
              <span className="data-table-count">{duplicates.length} items flagged</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 18px', fontWeight: 600 }}>Group</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600 }}>Day / Lobby</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600 }}>Official Name</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600 }}>Keep Entry</th>
                    <th style={{ padding: '12px 18px', fontWeight: 600 }}>Delete Entry (Duplicates)</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((dup, index) => {
                    const { toKeep, toDelete, groupName, day, lobby, name } = dup;
                    return (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border)', background: index % 2 === 0 ? 'transparent' : 'var(--bg-alt-row)' }}>
                        <td style={{ padding: '14px 18px' }}>
                          <span style={{
                            fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                            background: 'rgba(201,168,76,0.12)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)'
                          }}>
                            {groupName}
                          </span>
                        </td>
                        <td style={{ padding: '14px 18px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                          Day {day}, Lobby {lobby}
                        </td>
                        <td style={{ padding: '14px 18px', color: 'var(--gold)', fontWeight: 600 }}>
                          {name}
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{
                            display: 'inline-flex', flexDirection: 'column', gap: 3,
                            background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                            padding: '6px 12px', borderRadius: 6, fontSize: '0.8rem'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 700, color: 'rgb(16, 185, 129)' }}>
                                "{toKeep.teamName || toKeep.playerName || toKeep.ign}"
                              </span>
                              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                [{groupName}]
                              </span>
                            </div>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              ID: {toKeep.id.substring(0, 8)}... {scanType === 'team' ? `(Place: ${toKeep.placement}, Kills: ${toKeep.kills})` : `(Kills: ${toKeep.kills ?? '—'}, Dmg: ${toKeep.damage ?? '—'})`}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 18px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {toDelete.map((del, dIdx) => (
                              <div key={dIdx} style={{
                                display: 'inline-flex', flexDirection: 'column', gap: 3,
                                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                padding: '6px 12px', borderRadius: 6, fontSize: '0.8rem', alignSelf: 'flex-start'
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ fontWeight: 700, color: 'rgb(239, 68, 68)' }}>
                                    "{del.teamName || del.playerName || del.ign}"
                                  </span>
                                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    [{groupName}]
                                  </span>
                                </div>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  ID: {del.id.substring(0, 8)}... {scanType === 'team' ? `(Place: ${del.placement}, Kills: ${del.kills})` : `(Kills: ${del.kills ?? '—'}, Dmg: ${del.damage ?? '—'})`}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
