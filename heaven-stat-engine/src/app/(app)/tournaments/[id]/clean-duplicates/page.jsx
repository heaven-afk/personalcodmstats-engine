'use client';
import { useState, useEffect } from 'react';
import { useTournament } from '../layout';
import { getTeamMatchResults, deleteTeamMatchResult } from '@/lib/firestore/matchData';
import { getTeamRegistrations } from '@/lib/firestore/tournaments';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { AlertTriangle, CheckCircle, Trash2, ShieldAlert } from 'lucide-react';
import toast from 'react-hot-toast';

export default function CleanDuplicatesPage() {
  const { tournament } = useTournament();
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const [registeredNames, setRegisteredNames] = useState(new Set());

  // Load registrations and match results to identify duplicates
  const scanForDuplicates = async () => {
    setScanning(true);
    try {
      // 1. Get official registered team names
      const teamRegs = await getTeamRegistrations(tournament.id);
      const names = new Set(teamRegs.map(r => r.teamName).filter(Boolean));
      setRegisteredNames(names);

      // 2. Get match results
      const tr = await getTeamMatchResults(tournament.id);

      // Group results by day, lobby, and normalized teamName
      const groups = {};
      tr.forEach((doc) => {
        const normalizedName = (doc.teamName || "").trim().toLowerCase();
        const key = `${doc.day}_${doc.lobby}_${normalizedName}`;
        if (!groups[key]) groups[key] = [];
        groups[key].push(doc);
      });

      // Find duplicates
      const dupList = [];
      for (const [key, list] of Object.entries(groups)) {
        if (list.length > 1) {
          // Determine best entry to keep: one matching registration exactly
          let keepIndex = -1;
          for (let i = 0; i < list.length; i++) {
            if (names.has(list[i].teamName)) {
              keepIndex = i;
              break;
            }
          }
          if (keepIndex === -1) keepIndex = 0;

          const toKeep = list[keepIndex];
          const toDelete = list.filter((_, idx) => idx !== keepIndex);
          
          dupList.push({
            key,
            toKeep,
            toDelete,
          });
        }
      }
      setDuplicates(dupList);
    } catch (e) {
      toast.error('Error scanning for duplicates: ' + e.message);
    } finally {
      setScanning(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    scanForDuplicates();
  }, [tournament.id]);

  const handleDeleteDuplicates = async () => {
    if (duplicates.length === 0) return;
    if (!confirm(`Are you sure you want to delete all ${duplicates.reduce((acc, d) => acc + d.toDelete.length, 0)} duplicate match result entries? This cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    let deletedCount = 0;
    try {
      for (const dup of duplicates) {
        for (const item of dup.toDelete) {
          await deleteTeamMatchResult(tournament.id, item.id);
          deletedCount++;
        }
      }
      toast.success(`Successfully deleted ${deletedCount} duplicate match result(s).`);
      await scanForDuplicates();
    } catch (e) {
      toast.error('Error deleting duplicates: ' + e.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" />;
  }

  const totalDeleteCount = duplicates.reduce((acc, d) => acc + d.toDelete.length, 0);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '20px 0' }}>
      <div className="card" style={{ marginBottom: 24 }}>
        <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '1.4rem' }}>
          <ShieldAlert className="text-gold" />
          Clean Duplicate Team Match Results
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: 8, lineHeight: 1.5 }}>
          Sometimes importing files or recording results multiple times can cause duplicate match records for the same team in the same day and lobby. This utility scans all team match results for this tournament and drops the duplicates.
        </p>
      </div>

      {duplicates.length === 0 ? (
        <div className="card" style={{
          background: 'rgba(16, 185, 129, 0.05)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          borderRadius: 8,
          padding: '24px 16px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12
        }}>
          <CheckCircle size={40} style={{ color: 'rgb(16, 185, 129)' }} />
          <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'rgb(16, 185, 129)' }}>Your database is clean!</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', maxWidth: 500 }}>
            No duplicate team match result entries (same team, day, and lobby) were found in this tournament.
          </p>
          <button 
            className="btn btn-secondary" 
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
                className="btn btn-secondary" 
                onClick={scanForDuplicates} 
                disabled={scanning || deleting}
              >
                {scanning ? 'Scanning...' : 'Rescan'}
              </button>
              <button 
                className="btn btn-primary" 
                onClick={handleDeleteDuplicates} 
                disabled={deleting || scanning}
                style={{ background: 'var(--red)', borderColor: 'var(--red)', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Trash2 size={16} />
                {deleting ? 'Deleting...' : `Delete ${totalDeleteCount} Duplicates`}
              </button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <h3 className="card-title">Duplicate Groups Analysis</h3>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-header)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>Day / Lobby</th>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>Official Name</th>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>Keep Entry</th>
                    <th style={{ padding: '12px 20px', fontWeight: 600 }}>Delete Entry (Duplicates)</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((dup, index) => {
                    const { toKeep, toDelete } = dup;
                    return (
                      <tr key={index} style={{ borderBottom: '1px solid var(--border)', background: index % 2 === 0 ? 'transparent' : 'var(--bg-alt-row)' }}>
                        <td style={{ padding: '14px 20px', fontWeight: 500, color: 'var(--text-primary)' }}>
                          Day {toKeep.day}, Lobby {toKeep.lobby}
                        </td>
                        <td style={{ padding: '14px 20px', color: 'var(--gold)', fontWeight: 600 }}>
                          {toKeep.teamName.trim()}
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{
                            display: 'inline-flex', flexDirection: 'column', gap: 2,
                            background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)',
                            padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem'
                          }}>
                            <span style={{ fontWeight: 600, color: 'rgb(16, 185, 129)' }}>
                              "{toKeep.teamName}"
                            </span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                              ID: {toKeep.id.substring(0, 8)}... (Place: {toKeep.placement}, Kills: {toKeep.kills})
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '14px 20px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {toDelete.map((del, dIdx) => (
                              <div key={dIdx} style={{
                                display: 'inline-flex', flexDirection: 'column', gap: 2,
                                background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                padding: '6px 10px', borderRadius: 4, fontSize: '0.8rem', alignSelf: 'flex-start'
                              }}>
                                <span style={{ fontWeight: 600, color: 'rgb(239, 68, 68)' }}>
                                  "{del.teamName}"
                                </span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  ID: {del.id.substring(0, 8)}... (Place: {del.placement}, Kills: {del.kills})
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
