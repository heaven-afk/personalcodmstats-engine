'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updatePassword, getAuth } from 'firebase/auth';
import { isFirebaseConfigured } from '@/lib/firebase';
import { migrateLocalToFirebase, exportLocalDatabaseAsJSON } from '@/lib/firestore/migrateToFirebase';
import {
  Settings, User, Shield, Key, RefreshCw, Info,
  Database, CloudUpload, Download, CheckCircle, AlertCircle,
  Loader, ArrowRight, WifiOff, Wifi,
} from 'lucide-react';
import toast from 'react-hot-toast';

// ─── Migration progress step label map ────────────────────────────────────────
const STEP_LABELS = {
  players: 'Players',
  teams: 'Teams',
  clans: 'Clans',
  tournaments: 'Tournaments, Registrations & Match Results',
};

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updating, setUpdating] = useState(false);

  // Migration state
  const [migrating, setMigrating] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);
  const [migrationSummary, setMigrationSummary] = useState(null);
  const [migrationLog, setMigrationLog] = useState([]);
  const [currentStep, setCurrentStep] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword) { toast.error('Password cannot be empty'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setUpdating(true);
    try {
      const auth = getAuth();
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        toast.success('Password updated successfully!');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        toast.error('No authenticated user found');
      }
    } catch (err) {
      toast.error('Failed to update password: ' + err.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleExport = () => {
    try {
      exportLocalDatabaseAsJSON();
      toast.success('Database exported as JSON backup!');
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    }
  };

  const handleMigrate = async () => {
    setShowConfirm(false);
    setMigrating(true);
    setMigrationDone(false);
    setMigrationLog([]);
    setCurrentStep(null);

    try {
      const summary = await migrateLocalToFirebase((progress) => {
        if (progress.message) {
          setMigrationLog((prev) => [...prev, progress.message]);
        }
        if (progress.step) {
          setCurrentStep(STEP_LABELS[progress.step] || progress.step);
        }
      });
      setMigrationSummary(summary);
      setMigrationDone(true);
      toast.success('All data successfully migrated to Firebase!');
    } catch (err) {
      toast.error('Migration failed: ' + err.message);
      setMigrationLog((prev) => [...prev, `❌ Error: ${err.message}`]);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }} className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account credentials, database, and system settings</p>
        </div>
      </div>

      {/* ── Database Mode Status ─────────────────────────────────────────────── */}
      <div className="card" style={{
        border: isFirebaseConfigured
          ? '1px solid rgba(0,200,120,0.35)'
          : '1px solid rgba(201,168,76,0.35)',
      }}>
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <Database size={18} style={{ color: isFirebaseConfigured ? 'var(--success, #22c55e)' : 'var(--gold)' }} />
          Database Mode
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: isFirebaseConfigured ? 'rgba(34,197,94,0.15)' : 'rgba(201,168,76,0.15)',
            border: `1px solid ${isFirebaseConfigured ? 'rgba(34,197,94,0.4)' : 'rgba(201,168,76,0.4)'}`,
            flexShrink: 0,
          }}>
            {isFirebaseConfigured
              ? <Wifi size={20} style={{ color: '#22c55e' }} />
              : <WifiOff size={20} style={{ color: 'var(--gold)' }} />}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              {isFirebaseConfigured ? 'Live Firebase Mode' : 'Offline Demo Mode'}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {isFirebaseConfigured
                ? 'Connected to your Firebase project. All data is stored in Firestore.'
                : 'Running with browser localStorage only. Data is stored on this device.'}
            </div>
          </div>
        </div>

        {!isFirebaseConfigured && (
          <div style={{
            padding: '10px 14px', borderRadius: 8,
            background: 'rgba(201,168,76,0.07)',
            border: '1px solid rgba(201,168,76,0.2)',
            fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--gold)' }}>To connect Firebase:</strong> Copy{' '}
            <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 4 }}>.env.local.example</code>{' '}
            to <code style={{ fontFamily: 'var(--font-mono)', background: 'rgba(255,255,255,0.05)', padding: '1px 5px', borderRadius: 4 }}>.env.local</code>{' '}
            and fill in your Firebase project credentials, then restart the server.
          </div>
        )}
      </div>

      {/* ── Database Migration ───────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <CloudUpload size={18} style={{ color: 'var(--gold)' }} />
          Database Migration
        </h2>

        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 18, lineHeight: 1.65 }}>
          Export your current offline database as a JSON backup, or migrate it directly to your connected Firebase project.
          Migration preserves all tournament data, player stats, registrations, and match results.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: migrationDone || migrating ? 20 : 0 }}>
          {/* Export Button — always available */}
          <button
            className="btn btn-secondary"
            onClick={handleExport}
            style={{ display: 'flex', alignItems: 'center', gap: 7 }}
          >
            <Download size={14} />
            Export as JSON Backup
          </button>

          {/* Migrate Button — only useful when Firebase is live */}
          {isFirebaseConfigured && !migrationDone && (
            <button
              className="btn btn-primary"
              onClick={() => setShowConfirm(true)}
              disabled={migrating}
              style={{ display: 'flex', alignItems: 'center', gap: 7 }}
            >
              {migrating
                ? <><Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> Migrating…</>
                : <><CloudUpload size={14} /> Migrate Offline Data to Firebase</>}
            </button>
          )}

          {!isFirebaseConfigured && (
            <div style={{
              padding: '8px 14px', borderRadius: 8, fontSize: '0.78rem',
              color: 'var(--text-muted)', background: 'var(--bg-alt-row)',
              border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 7,
            }}>
              <AlertCircle size={13} />
              Connect Firebase first to enable migration
            </div>
          )}
        </div>

        {/* ── Confirm Dialog ─────────────────────────────────────────────────── */}
        {showConfirm && (
          <div style={{
            marginTop: 16, padding: '18px 20px', borderRadius: 10,
            background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
              <AlertCircle size={16} style={{ color: 'var(--danger, #ef4444)', flexShrink: 0 }} />
              <strong style={{ color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                Confirm Migration
              </strong>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
              This will write all offline data to your Firebase project. Existing Firestore documents
              with the same IDs will be <strong>overwritten</strong>. Your local data will not be deleted.
              We recommend exporting a JSON backup first.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary btn-sm" onClick={handleMigrate}>
                <ArrowRight size={13} /> Yes, Migrate Now
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Migration Progress Log ─────────────────────────────────────────── */}
        {(migrating || migrationDone) && migrationLog.length > 0 && (
          <div style={{
            marginTop: 16, padding: '14px 16px', borderRadius: 9,
            background: 'var(--bg-alt-row)', border: '1px solid var(--border-md)',
          }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Migration Log
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {migrationLog.map((line, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                  {migrationDone || i < migrationLog.length - 1
                    ? <CheckCircle size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                    : <Loader size={13} style={{ color: 'var(--gold)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />}
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Migration Summary ──────────────────────────────────────────────── */}
        {migrationDone && migrationSummary && (
          <div style={{
            marginTop: 14, padding: '14px 18px', borderRadius: 9,
            background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.3)',
            display: 'flex', alignItems: 'flex-start', gap: 12,
          }}>
            <CheckCircle size={20} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
            <div>
              <div style={{ fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>Migration Complete!</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                <span>🏆 <strong>{migrationSummary.tournaments}</strong> Tournaments</span>
                <span>👤 <strong>{migrationSummary.players}</strong> Players</span>
                <span>🛡️ <strong>{migrationSummary.teams}</strong> Teams</span>
                <span>⚔️ <strong>{migrationSummary.clans}</strong> Clans</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Account Info ─────────────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <User size={18} className="text-gold" />
          Account Profile
        </h2>
        <div className="space-y-3 text-sm">
          <div className="flex-between">
            <span className="text-text-muted">Authenticated Email</span>
            <span className="font-semibold text-text-primary">{user?.email || '—'}</span>
          </div>
          <div className="flex-between">
            <span className="text-text-muted">User ID</span>
            <span className="font-mono text-xs text-text-secondary">{user?.uid || '—'}</span>
          </div>
          <div className="flex-between">
            <span className="text-text-muted">App Role</span>
            <span className="font-semibold text-gold">Owner / Administrator</span>
          </div>
        </div>
      </div>

      {/* ── Change Password ───────────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <Key size={18} className="text-gold" />
          Change Password
        </h2>
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div className="form-field">
            <label className="form-label">New Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter new password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
            />
          </div>
          <div className="form-field">
            <label className="form-label">Confirm New Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="Re-enter new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={updating}>
            {updating ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* ── System Info ───────────────────────────────────────────────────────── */}
      <div className="card">
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <Info size={18} className="text-gold" />
          About Heaven Stat Engine
        </h2>
        <div className="space-y-2.5 text-xs text-text-secondary">
          <p><strong>Stack:</strong> Next.js (App Router), Firebase Firestore, Firebase Authentication.</p>
          <p><strong>Version:</strong> v1.0.0 (Production Release)</p>
          <p>This application replaces legacy Excel templates for CODM Battle Royale tournament tracking, consolidating player, team, and clan data into a central cloud database.</p>
        </div>
      </div>
    </div>
  );
}
