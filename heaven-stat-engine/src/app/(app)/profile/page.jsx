'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { updatePassword, getAuth } from 'firebase/auth';
import { isFirebaseConfigured } from '@/lib/firebase';
import { getAllowedUsers, subscribeAllowedUsers, removeAllowedUser, updateAllowedUserRole } from '@/lib/firestore/allowedUsers';
import { getTournaments, updateTournamentEditors } from '@/lib/firestore/tournaments';
import { useAllPresence } from '@/hooks/usePresence';
import { uploadToCloudinary } from '@/lib/utils/cloudinary';
import UserAvatar from '@/components/ui/UserAvatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  User, Shield, Key, Camera, Upload, Trash2, Plus, Users, Trophy,
  CheckCircle, AlertCircle, RefreshCw, X, ShieldAlert, Sparkles, Clock, Mail, Copy, Check
} from 'lucide-react';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const { user, profile, displayName, role, isOwner, isOperator, updateProfile, refreshProfile } = useAuth();

  // Tab State: 'profile' | 'admin'
  const [activeTab, setActiveTab] = useState('profile');

  // Profile Edit State
  const [usernameInput, setUsernameInput] = useState('');
  const [avatarUrlInput, setAvatarUrlInput] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // Admin Dashboard State
  const [allowedUsersList, setAllowedUsersList] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [addUserModalOpen, setAddUserModalOpen] = useState(false);
  const [createdCredentialsModal, setCreatedCredentialsModal] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [addingUser, setAddingUser] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  // Tournament Access Management State
  const [tournaments, setTournaments] = useState([]);
  const [selectedTourneyId, setSelectedTourneyId] = useState('');
  const [savingTourneyAccess, setSavingTourneyAccess] = useState(false);

  const presenceMap = useAllPresence();

  // Populate profile inputs
  useEffect(() => {
    if (profile) {
      setUsernameInput(profile.username || user?.email || '');
      setAvatarUrlInput(profile.avatarUrl || '');
    } else if (user) {
      setUsernameInput(user.email || '');
    }
  }, [profile, user]);

  // Load Admin Data (allowed users & tournaments) if Owner
  useEffect(() => {
    if (!isOwner) return;

    // Real-time listener for allowed users
    const unsubscribeUsers = subscribeAllowedUsers(
      (users) => {
        setAllowedUsersList(users);
        setLoadingUsers(false);
      },
      (err) => {
        console.error('Error fetching allowed users:', err);
        setLoadingUsers(false);
      }
    );

    // Fetch tournaments for access management
    async function loadTournaments() {
      try {
        const list = await getTournaments();
        setTournaments(list);
        if (list.length > 0 && !selectedTourneyId) {
          setSelectedTourneyId(list[0].id);
        }
      } catch (err) {
        console.error('Error loading tournaments for admin:', err);
      }
    }
    loadTournaments();

    return () => {
      unsubscribeUsers();
    };
  }, [isOwner]);

  // ─── Profile Handlers ────────────────────────────────────────────────────────
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!usernameInput.trim()) {
      toast.error('Username cannot be empty');
      return;
    }
    setSavingProfile(true);
    try {
      await updateProfile({
        username: usernameInput.trim(),
        avatarUrl: avatarUrlInput.trim() || null,
      });
      toast.success('Profile updated successfully!');
      setAvatarModalOpen(false);
    } catch (err) {
      toast.error('Failed to update profile: ' + err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error('File size exceeds 5MB limit');
      return;
    }

    setUploadingAvatar(true);
    try {
      const url = await uploadToCloudinary(file, 'heaven-engine/user-avatars');
      setAvatarUrlInput(url);
      toast.success('Avatar uploaded! Click Save to apply.');
    } catch (err) {
      toast.error('Avatar upload failed: ' + err.message);
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (!newPassword) { toast.error('Password cannot be empty'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setUpdatingPassword(true);
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
      setUpdatingPassword(false);
    }
  };

  // ─── Admin Dashboard Handlers ────────────────────────────────────────────────
  const handleAddUser = async (e) => {
    e.preventDefault();
    if (!newEmail.trim()) {
      toast.error('Email is required');
      return;
    }
    const cleanEmail = newEmail.trim().toLowerCase();
    setAddingUser(true);

    try {
      // 1. Write allowedUser doc to Firestore
      const { addAllowedUser } = await import('@/lib/firestore/allowedUsers');
      await addAllowedUser({
        email: cleanEmail,
        role: newRole,
        username: cleanEmail,
        addedBy: user?.uid || 'owner',
      });

      // 2. If live Firebase, sync custom claims via Admin API
      if (isFirebaseConfigured) {
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          const res = await fetch('/api/admin/users', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email: cleanEmail,
              role: newRole,
              username: cleanEmail,
            }),
          });
          const data = await res.json();
          if (data.tempPassword) {
            setCreatedCredentialsModal({
              email: cleanEmail,
              tempPassword: data.tempPassword,
              role: newRole,
            });
          }
        } catch (claimErr) {
          console.warn('Custom claim sync note:', claimErr);
        }
      }

      toast.success(`User ${cleanEmail} added as ${newRole}!`);
      setNewEmail('');
      setNewRole('operator');
      setAddUserModalOpen(false);
    } catch (err) {
      toast.error('Error adding user: ' + err.message);
    } finally {
      setAddingUser(false);
    }
  };

  const handleTestEmail = async () => {
    if (!user?.email) {
      toast.error('No logged in user email found');
      return;
    }
    setTestingEmail(true);
    try {
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: user.email }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        const msg = data.error?.message || data.error || 'Failed to send test email';
        toast.error(`Resend Error: ${msg}`, { duration: 6000 });
      } else {
        toast.success(data.message || `Test email dispatched to ${user.email}!`, { duration: 5000 });
      }
    } catch (err) {
      toast.error('Network error testing email: ' + err.message);
    } finally {
      setTestingEmail(false);
    }
  };

  const handleRoleToggle = async (targetEmail, currentRole) => {
    const nextRole = currentRole === 'owner' ? 'operator' : 'owner';
    const normalizedEmail = targetEmail.trim().toLowerCase();

    if (normalizedEmail === user?.email?.toLowerCase() && nextRole !== 'owner') {
      toast.error('You cannot demote your own account from owner');
      return;
    }

    try {
      // 1. Update Firestore doc
      await updateAllowedUserRole(normalizedEmail, nextRole);

      // 2. If live Firebase, update custom claims via Admin API
      if (isFirebaseConfigured) {
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          await fetch('/api/admin/users', {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ email: normalizedEmail, role: nextRole }),
          });
        } catch (claimErr) {
          console.warn('Role claim update note:', claimErr);
        }
      }

      toast.success(`Updated ${normalizedEmail} to ${nextRole}`);
    } catch (err) {
      toast.error('Error changing role: ' + err.message);
    }
  };

  const handleRemoveUser = async (targetEmail) => {
    const normalizedEmail = targetEmail.trim().toLowerCase();
    if (normalizedEmail === user?.email?.toLowerCase()) {
      toast.error('Cannot remove your own account');
      return;
    }

    if (!confirm(`Are you sure you want to remove ${normalizedEmail}? They will immediately lose access.`)) {
      return;
    }

    try {
      // 1. Remove from Firestore
      await removeAllowedUser(normalizedEmail);

      // 2. If live Firebase, revoke tokens via Admin API
      if (isFirebaseConfigured) {
        try {
          const auth = getAuth();
          const token = await auth.currentUser?.getIdToken();
          await fetch(`/api/admin/users?email=${encodeURIComponent(normalizedEmail)}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
        } catch (revokeErr) {
          console.warn('Revoke token note:', revokeErr);
        }
      }

      toast.success(`Removed ${normalizedEmail} from allowlist`);
    } catch (err) {
      toast.error('Error removing user: ' + err.message);
    }
  };

  // Tournament Access Toggle
  const handleToggleTournamentOperator = async (tournamentId, operatorEmail) => {
    const tourney = tournaments.find(t => t.id === tournamentId);
    if (!tourney) return;

    const currentEditors = tourney.editorUids || [];
    const isAlreadyEditor = currentEditors.includes(operatorEmail);

    const updatedEditors = isAlreadyEditor
      ? currentEditors.filter(e => e !== operatorEmail)
      : [...currentEditors, operatorEmail];

    setSavingTourneyAccess(true);
    try {
      await updateTournamentEditors(tournamentId, updatedEditors);
      setTournaments(prev => prev.map(t => t.id === tournamentId ? { ...t, editorUids: updatedEditors } : t));
      toast.success(`Updated operator access for ${tourney.name}`);
    } catch (err) {
      toast.error('Failed to update tournament access: ' + err.message);
    } finally {
      setSavingTourneyAccess(false);
    }
  };

  const selectedTourney = tournaments.find(t => t.id === selectedTourneyId);
  const operatorUsers = allowedUsersList.filter(u => u.role === 'operator');

  return (
    <div style={{ maxWidth: 840, margin: '0 auto' }} className="space-y-6">
      {/* Page Header with Tab Navigation */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">User Profile & Settings</h1>
          <p className="page-subtitle">Manage your personal identity, presence, credentials, and tournament access permissions</p>
        </div>

        {/* Tab Selector */}
        {isOwner && (
          <div style={{ display: 'flex', gap: 6, background: 'var(--bg-card)', padding: 4, borderRadius: 10, border: '1px solid var(--border)' }}>
            <button
              className={`btn btn-sm ${activeTab === 'profile' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('profile')}
              style={{ fontSize: '0.8rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <User size={14} /> My Profile
            </button>
            <button
              className={`btn btn-sm ${activeTab === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveTab('admin')}
              style={{ fontSize: '0.8rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Shield size={14} /> Admin Dashboard
              <span style={{ fontSize: '0.65rem', background: 'rgba(201,168,76,0.3)', padding: '1px 6px', borderRadius: 10, color: 'var(--gold)', fontWeight: 800 }}>
                Owner
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* TAB 1: MY PROFILE                                                         */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'profile' && (
        <div className="space-y-6">
          {/* Identity Spotlight Card */}
          <div className="card" style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
              {/* Avatar Frame */}
              <div style={{ position: 'relative' }}>
                <UserAvatar
                  src={avatarUrlInput || profile?.avatarUrl}
                  name={displayName}
                  uid={user?.uid}
                  size="2xl"
                  showPresence={true}
                />
                <button
                  onClick={() => setAvatarModalOpen(true)}
                  title="Change Avatar"
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    width: 28,
                    height: 28,
                    borderRadius: '50%',
                    background: 'var(--gold)',
                    color: '#000',
                    border: '2px solid var(--bg-card)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                    transition: 'transform 0.15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <Camera size={14} />
                </button>
              </div>

              {/* Identity Details */}
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
                    {displayName}
                  </h2>
                  <span style={{
                    fontSize: '0.7rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontWeight: 700,
                    background: isOwner ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
                    color: isOwner ? 'var(--gold)' : '#60a5fa',
                    border: `1px solid ${isOwner ? 'rgba(201,168,76,0.3)' : 'rgba(59,130,246,0.3)'}`,
                  }}>
                    {isOwner ? '👑 Owner' : '🛠️ Operator'}
                  </span>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Mail size={13} /> {user?.email || '—'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.75rem',
                    color: '#22c55e',
                    background: 'rgba(34,197,94,0.1)',
                    padding: '2px 8px',
                    borderRadius: 20,
                    border: '1px solid rgba(34,197,94,0.25)'
                  }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
                    Live Presence Active
                  </span>
                </div>
              </div>

              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setAvatarModalOpen(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              >
                <Camera size={14} /> Edit Avatar
              </button>
            </div>
          </div>

          {/* Edit Profile Form */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <User size={18} className="text-gold" />
              Edit Display Info
            </h2>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="form-field">
                <label className="form-label" style={{ fontWeight: 600 }}>Username (Display Name)</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="Your display username"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  required
                />
                <p className="text-xs text-text-muted mt-1">
                  Shown in tournament headers, match logs, and presence lists across Heaven Engine.
                </p>
              </div>

              <div className="form-field">
                <label className="form-label" style={{ fontWeight: 600 }}>Email Address (Identity Key)</label>
                <input
                  type="text"
                  className="form-input"
                  value={user?.email || ''}
                  disabled
                  style={{ opacity: 0.65, cursor: 'not-allowed', background: 'var(--bg-alt-row)' }}
                />
                <p className="text-xs text-text-muted mt-1">
                  Non-editable. Your email is your allowlisted identity key.
                </p>
              </div>

              <div className="form-field">
                <label className="form-label" style={{ fontWeight: 600 }}>Role Assignment</label>
                <input
                  type="text"
                  className="form-input"
                  value={isOwner ? 'Owner / System Administrator' : 'Tournament Operator'}
                  disabled
                  style={{ opacity: 0.65, cursor: 'not-allowed', background: 'var(--bg-alt-row)' }}
                />
                <p className="text-xs text-text-muted mt-1">
                  Role assignments are managed exclusively by the system owner.
                </p>
              </div>

              <button type="submit" className="btn btn-primary" disabled={savingProfile}>
                {savingProfile ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </form>
          </div>

          {/* Change Password Card */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Key size={18} className="text-gold" />
              Change Password
            </h2>
            <form onSubmit={handlePasswordChange} className="space-y-4">
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
              <button type="submit" className="btn btn-primary" disabled={updatingPassword}>
                {updatingPassword ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────── */}
      {/* TAB 2: ADMIN DASHBOARD (OWNER ONLY)                                       */}
      {/* ───────────────────────────────────────────────────────────────────────── */}
      {activeTab === 'admin' && isOwner && (
        <div className="space-y-6">
          {/* Allowlist Users Management */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <div>
                <h2 className="card-title flex items-center gap-2" style={{ margin: 0 }}>
                  <Users size={18} className="text-gold" />
                  Allowlisted Users & Presence
                </h2>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
                  Only emails listed below can access Heaven Stat Engine. Remove access instantly with one click.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={handleTestEmail}
                  disabled={testingEmail}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                  title="Send a test email to your account to verify Resend delivery"
                >
                  <Mail size={14} className={testingEmail ? 'animate-spin' : ''} />
                  {testingEmail ? 'Sending Test...' : 'Test Email Connection'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setAddUserModalOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Plus size={14} /> Add User
                </button>
              </div>
            </div>

            {loadingUsers ? (
              <LoadingSpinner size="md" text="Loading allowlisted users..." />
            ) : allowedUsersList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                No allowlisted users found.
              </div>
            ) : (
              <div className="table-container">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>Status</th>
                      <th>User</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Added Date</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allowedUsersList.map((u) => {
                      const userPresence = presenceMap[u.uid] || { state: 'offline' };
                      const isUserOnline = userPresence.state === 'online';
                      const isSelf = u.email?.toLowerCase() === user?.email?.toLowerCase();

                      return (
                        <tr key={u.email}>
                          <td>
                            <UserAvatar
                              src={u.avatarUrl}
                              name={u.username || u.email}
                              uid={u.uid}
                              status={isUserOnline ? 'online' : 'offline'}
                              size="sm"
                              showPresence={true}
                            />
                          </td>
                          <td>
                            <strong style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                              {u.username || u.email}
                            </strong>
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            {u.email}
                          </td>
                          <td>
                            <button
                              onClick={() => !isSelf && handleRoleToggle(u.email, u.role)}
                              disabled={isSelf}
                              title={isSelf ? 'Cannot modify your own role' : 'Click to toggle role'}
                              style={{
                                cursor: isSelf ? 'default' : 'pointer',
                                fontSize: '0.72rem',
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                padding: '3px 8px',
                                borderRadius: 4,
                                fontWeight: 700,
                                background: u.role === 'owner' ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
                                color: u.role === 'owner' ? 'var(--gold)' : '#60a5fa',
                                border: `1px solid ${u.role === 'owner' ? 'rgba(201,168,76,0.3)' : 'rgba(59,130,246,0.3)'}`,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4
                              }}
                            >
                              {u.role === 'owner' ? '👑 Owner' : '🛠️ Operator'}
                            </button>
                          </td>
                          <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {u.addedAt ? (
                              typeof u.addedAt.toDate === 'function'
                                ? u.addedAt.toDate().toLocaleDateString()
                                : new Date(u.addedAt).toLocaleDateString()
                            ) : '—'}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {!isSelf && (
                              <button
                                onClick={() => handleRemoveUser(u.email)}
                                className="btn btn-danger btn-sm"
                                style={{ padding: '3px 8px', fontSize: '0.72rem' }}
                                title="Remove User & Revoke Session"
                              >
                                <Trash2 size={12} /> Remove
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tournament Operator Access Management */}
          <div className="card">
            <h2 className="card-title mb-4 flex items-center gap-2 border-b border-border pb-2">
              <Trophy size={18} className="text-gold" />
              Tournament Operator Access Management
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Grant or revoke operator editing permissions on a per-tournament basis (`editorUids`).
            </p>

            {tournaments.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No tournaments found.</div>
            ) : (
              <div className="space-y-4">
                {/* Select Tournament */}
                <div className="form-field">
                  <label className="form-label" style={{ fontWeight: 600 }}>Select Tournament</label>
                  <select
                    className="form-input"
                    value={selectedTourneyId}
                    onChange={(e) => setSelectedTourneyId(e.target.value)}
                  >
                    {tournaments.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.season || 'No Season'}) · Status: {t.status}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedTourney && (
                  <div style={{
                    padding: 16,
                    background: 'var(--bg-alt-row)',
                    borderRadius: 8,
                    border: '1px solid var(--border-md)'
                  }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 10 }}>
                      Assigned Operators for: <span style={{ color: 'var(--gold)' }}>{selectedTourney.name}</span>
                    </div>

                    {operatorUsers.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        No operators found in the allowlist. Add operators above first.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {operatorUsers.map(op => {
                          const isAssigned = (selectedTourney.editorUids || []).includes(op.email);
                          return (
                            <div
                              key={op.email}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '8px 12px',
                                background: 'var(--bg-card)',
                                borderRadius: 6,
                                border: '1px solid var(--border)'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <UserAvatar src={op.avatarUrl} name={op.username || op.email} size="xs" />
                                <div>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    {op.username || op.email}
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                    {op.email}
                                  </div>
                                </div>
                              </div>

                              <button
                                type="button"
                                className={`btn btn-sm ${isAssigned ? 'btn-primary' : 'btn-secondary'}`}
                                style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                                disabled={savingTourneyAccess}
                                onClick={() => handleToggleTournamentOperator(selectedTourney.id, op.email)}
                              >
                                {isAssigned ? '✓ Access Granted' : '+ Grant Access'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Avatar Upload Modal ──────────────────────────────────────────────── */}
      {avatarModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-md)',
            borderRadius: 14, padding: 24, width: '100%', maxWidth: 440,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Camera size={18} className="text-gold" />
                Upload Profile Avatar
              </h3>
              <button
                onClick={() => setAvatarModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Live Avatar Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
              <UserAvatar
                src={avatarUrlInput}
                name={displayName}
                size="2xl"
                showPresence={true}
                status="online"
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                {avatarUrlInput ? 'Avatar Preview' : 'Initials Placeholder'}
              </span>
            </div>

            {/* File Upload Button */}
            <div style={{ marginBottom: 16 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Upload Image File</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarFileUpload}
                style={{ display: 'none' }}
                id="profile-avatar-file-upload"
              />
              <label
                htmlFor="profile-avatar-file-upload"
                className="btn btn-secondary btn-sm"
                style={{ width: '100%', cursor: 'pointer', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px' }}
              >
                {uploadingAvatar ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                {uploadingAvatar ? 'Uploading & Compressing...' : 'Choose Image File...'}
              </label>
            </div>

            {/* Direct URL input */}
            <div style={{ marginBottom: 20 }}>
              <label className="form-label" style={{ display: 'block', marginBottom: 6 }}>Or Paste Image / Cloudinary URL</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://res.cloudinary.com/... or image link"
                value={avatarUrlInput}
                onChange={e => setAvatarUrlInput(e.target.value)}
              />
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              {avatarUrlInput ? (
                <button
                  type="button"
                  onClick={() => setAvatarUrlInput('')}
                  className="btn btn-danger btn-sm"
                >
                  <Trash2 size={12} /> Clear
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setAvatarModalOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  className="btn btn-primary btn-sm"
                  disabled={savingProfile}
                >
                  {savingProfile ? 'Saving...' : 'Save Avatar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Add User Modal (Owner Only) ───────────────────────────────────────── */}
      {addUserModalOpen && isOwner && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-md)',
            borderRadius: 14, padding: 24, width: '100%', maxWidth: 440,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Plus size={18} className="text-gold" />
                Add Allowlisted User
              </h3>
              <button
                onClick={() => setAddUserModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="form-field">
                <label className="form-label" style={{ fontWeight: 600 }}>Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="operator@example.com"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-field">
                <label className="form-label" style={{ fontWeight: 600 }}>Assign App Role</label>
                <select
                  className="form-input"
                  value={newRole}
                  onChange={e => setNewRole(e.target.value)}
                >
                  <option value="operator">🛠️ Operator (Tournament Operations)</option>
                  <option value="owner">👑 Owner (Full System Administrator)</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setAddUserModalOpen(false)}
                  className="btn btn-secondary btn-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={addingUser}
                >
                  {addingUser ? 'Adding...' : 'Add to Allowlist'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Manual Credentials Modal (When Resend is not configured) ───────────── */}
      {createdCredentialsModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16
        }}>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-md)',
            borderRadius: 14, padding: 24, width: '100%', maxWidth: 460,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3 style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Key size={18} />
                User Account Created
              </h3>
              <button
                onClick={() => setCreatedCredentialsModal(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4 }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 16 }}>
              Because automatic email sending is not active, please copy and share these temporary login credentials directly with the user (e.g. via Discord or direct message).
            </p>

            <div style={{
              background: 'var(--bg-app)', border: '1px solid var(--border-subtle)',
              borderRadius: 8, padding: '12px 16px', fontSize: '0.82rem', fontFamily: 'var(--font-mono)',
              lineHeight: 1.8, marginBottom: 18
            }}>
              <div><strong>Email:</strong> {createdCredentialsModal.email}</div>
              <div><strong>Temporary Password:</strong> <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{createdCredentialsModal.tempPassword}</span></div>
              <div><strong>Role:</strong> {createdCredentialsModal.role}</div>
              <div><strong>Login URL:</strong> {typeof window !== 'undefined' ? `${window.location.origin}/login` : '/login'}</div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  const text = `Heaven Stat Engine Login Credentials:\nEmail: ${createdCredentialsModal.email}\nTemporary Password: ${createdCredentialsModal.tempPassword}\nRole: ${createdCredentialsModal.role}\nLogin URL: ${window.location.origin}/login\n\n(You will be prompted to choose a new password upon first sign in.)`;
                  navigator.clipboard.writeText(text);
                  toast.success('Credentials copied to clipboard!');
                }}
                className="btn btn-primary btn-sm"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Copy size={14} /> Copy Credentials
              </button>
              <button
                type="button"
                onClick={() => setCreatedCredentialsModal(null)}
                className="btn btn-secondary btn-sm"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
