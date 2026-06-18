'use client';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updatePassword, getAuth } from 'firebase/auth';
import { Settings, User, Shield, Key, RefreshCw, Info } from 'lucide-react';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    if (!newPassword) {
      toast.error('Password cannot be empty');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
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

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }} className="space-y-6">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your account credentials and system settings</p>
        </div>
      </div>

      {/* Account Info */}
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

      {/* Change Password */}
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

      {/* System info */}
      <div className="card">
        <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
          <Info size={18} className="text-gold" />
          About Heaven Stat Engine
        </h2>
        <div className="space-y-2.5 text-xs text-text-secondary">
          <p><strong>Stack:</strong> Next.js 14 (App Router), Firebase Firestore, Firebase Authentication.</p>
          <p><strong>Version:</strong> v1.0.0 (Production Release)</p>
          <p>This application replaces legacy Excel templates for CODM Battle Royale tournament tracking, consolidating player, team, and clan data into a central cloud database.</p>
        </div>
      </div>
    </div>
  );
}
