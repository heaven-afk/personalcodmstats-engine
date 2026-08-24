'use client';
import { useState, useRef, useEffect } from 'react';
import { useTournamentPresence } from '@/hooks/usePresence';
import { useAuth } from '@/contexts/AuthContext';
import UserAvatar from '@/components/ui/UserAvatar';
import { Users, Sparkles, Shield, Circle, ExternalLink } from 'lucide-react';

function formatPageLocation(pathname) {
  if (!pathname) return 'Overview';
  if (pathname.includes('/team-entry')) return 'Editing Team Entry';
  if (pathname.includes('/player-entry')) return 'Editing Player Entry';
  if (pathname.includes('/register')) return 'Managing Registrations';
  if (pathname.includes('/standings')) return 'Viewing Standings';
  if (pathname.includes('/extraction')) return 'Extraction & Reports';
  if (pathname.includes('/import')) return 'Bulk Importer';
  if (pathname.includes('/analytics')) return 'Analytics';
  if (pathname.includes('/config')) return 'Configuring Tournament';
  return 'In Project Hub';
}

export default function ActiveCollaborators({ tournamentId, size = 'sm' }) {
  const { user: currentUser } = useAuth();
  const activeUsers = useTournamentPresence(tournamentId);
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open]);

  if (!tournamentId) return null;

  // Deduplicate by UID
  const uniqueUsersMap = new Map();
  activeUsers.forEach(u => {
    if (u.uid && !uniqueUsersMap.has(u.uid)) {
      uniqueUsersMap.set(u.uid, u);
    }
  });

  const displayList = Array.from(uniqueUsersMap.values());
  const count = displayList.length;

  if (count === 0) return null;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen(prev => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px 4px 6px',
          background: 'rgba(15, 23, 42, 0.65)',
          border: '1px solid rgba(201, 168, 76, 0.3)',
          borderRadius: 999,
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          backdropFilter: 'blur(8px)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.borderColor = 'var(--gold)';
          e.currentTarget.style.background = 'rgba(201, 168, 76, 0.12)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.borderColor = 'rgba(201, 168, 76, 0.3)';
          e.currentTarget.style.background = 'rgba(15, 23, 42, 0.65)';
        }}
        title="View active users in this project"
      >
        {/* Avatar stack */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {displayList.slice(0, 4).map((u, idx) => (
            <div
              key={u.uid}
              style={{
                marginLeft: idx === 0 ? 0 : -8,
                zIndex: 10 - idx,
                position: 'relative',
              }}
            >
              <UserAvatar
                src={u.avatarUrl}
                name={u.username || u.email}
                uid={u.uid}
                status="online"
                size="xs"
                showPresence={true}
              />
            </div>
          ))}
          {count > 4 && (
            <div
              style={{
                marginLeft: -8,
                zIndex: 5,
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: 'var(--bg-card)',
                border: '1.5px solid var(--gold)',
                color: 'var(--gold)',
                fontSize: '0.62rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +{count - 4}
            </div>
          )}
        </div>

        {/* Live indicator text */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 6px #22c55e',
              display: 'inline-block',
              animation: 'pulse 2s infinite',
            }}
          />
          <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
            {count} {count === 1 ? 'Active' : 'Active'}
          </span>
        </div>
      </button>

      {/* Floating Popover Detail Panel */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            zIndex: 999,
            minWidth: 280,
            maxWidth: 340,
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid var(--border-gold)',
            borderRadius: 12,
            padding: '14px 16px',
            boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65), 0 0 20px rgba(201, 168, 76, 0.15)',
            backdropFilter: 'blur(16px)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 10,
              borderBottom: '1px solid var(--border-md)',
              marginBottom: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Users size={14} style={{ color: 'var(--gold)' }} />
              <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--gold)', letterSpacing: '0.04em' }}>
                ACTIVE IN PROJECT ({count})
              </span>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#22c55e', fontWeight: 700 }}>
              Live Real-Time
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
            {displayList.map(u => {
              const isMe = currentUser?.uid === u.uid;
              const location = formatPageLocation(u.pathname);
              return (
                <div
                  key={u.uid}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 8px',
                    borderRadius: 8,
                    background: isMe ? 'rgba(201, 168, 76, 0.08)' : 'rgba(255, 255, 255, 0.03)',
                    border: isMe ? '1px solid rgba(201, 168, 76, 0.25)' : '1px solid transparent',
                  }}
                >
                  <UserAvatar
                    src={u.avatarUrl}
                    name={u.username || u.email}
                    uid={u.uid}
                    status="online"
                    size="sm"
                    showPresence={true}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: '0.82rem',
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {u.username || u.email}
                      </span>
                      {isMe && (
                        <span style={{ fontSize: '0.62rem', fontWeight: 800, color: 'var(--gold)', background: 'rgba(201,168,76,0.15)', padding: '1px 5px', borderRadius: 4 }}>
                          YOU
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {location}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '2px 5px',
                      borderRadius: 4,
                      fontWeight: 700,
                      background: u.role === 'owner' ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
                      color: u.role === 'owner' ? 'var(--gold)' : '#60a5fa',
                      flexShrink: 0,
                    }}
                  >
                    {u.role === 'owner' ? 'Owner' : 'Operator'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
