'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Wordmark from '@/components/ui/Wordmark';
import UserAvatar from '@/components/ui/UserAvatar';
import {
  LayoutDashboard, FolderGit2, Trophy, Users, Shield, BarChart3, Settings, LogOut, GitCompare,
  FlaskConical, Sparkles, Coins, X, User as UserIcon
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',   label: 'Dashboard',     icon: LayoutDashboard },
  { href: '/projects',    label: 'My Projects',   icon: FolderGit2 },
  { href: '/tournaments', label: 'Tournaments',   icon: Trophy },
  { href: '/players',     label: 'Players',       icon: Users },
  { href: '/teams',       label: 'Teams',         icon: Shield },
  { href: '/fantasy',     label: 'BR Fantasy',    icon: Coins },
  { href: '/comparison',  label: 'Comparison',    icon: GitCompare },
  { href: '/rankings',    label: 'Rankings',      icon: BarChart3 },
  { href: '/analysis',    label: 'Deep Analysis', icon: Sparkles },
  { href: '/simulate',    label: 'Simulate',      icon: FlaskConical },
  { href: '/settings',    label: 'Settings',      icon: Settings },
];

export default function Sidebar({ mobileOpen, onClose }) {
  const pathname = usePathname();
  const { user, profile, displayName, logout, isOwner, isOperator, role } = useAuth();

  const isActive = (href) => {
    return pathname.startsWith(href);
  };

  // Role-gate navigation: operators see Dashboard, My Projects, Tournaments, Players, Teams, Settings
  const visibleNav = NAV.filter(item => {
    if (isOperator) {
      return ['/dashboard', '/projects', '/tournaments', '/players', '/teams', '/settings'].includes(item.href);
    }
    return true;
  });

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      {/* Mobile close button */}
      <button 
        className="mobile-sidebar-close" 
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          color: 'var(--text-muted)',
          display: 'none'
        }}
      >
        <X size={20} />
      </button>

      {/* Logo Wordmark Header */}
      <div className="sidebar-logo" style={{ padding: '24px 18px 20px' }}>
        <Wordmark size="sm" />
        {role && (
          <div style={{
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            padding: '2px 6px',
            borderRadius: 4,
            display: 'inline-block',
            marginTop: 4,
            fontWeight: 700,
            background: isOwner ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
            color: isOwner ? 'var(--gold)' : '#60a5fa',
            border: `1px solid ${isOwner ? 'rgba(201,168,76,0.3)' : 'rgba(59,130,246,0.3)'}`,
          }}>
            {isOwner ? '👑 Owner' : '🛠️ Operator'}
          </div>
        )}
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {visibleNav.map(({ href, label, icon: Icon }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={`sidebar-link ${active ? 'active' : ''}`}
            >
              <Icon size={17} style={{ color: active ? 'var(--gold)' : 'inherit' }} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-divider" />

      {/* User Profile Bar */}
      <div style={{ padding: '8px 12px' }}>
        <Link
          href="/profile"
          onClick={onClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: pathname === '/profile' ? 'var(--bg-alt-row)' : 'transparent',
            border: pathname === '/profile' ? '1px solid var(--border-gold)' : '1px solid transparent',
            textDecoration: 'none',
            transition: 'background 0.15s, border-color 0.15s',
          }}
          className="hover:bg-bg-alt-row"
        >
          <UserAvatar
            src={profile?.avatarUrl}
            name={displayName}
            uid={user?.uid}
            size="sm"
            showPresence={true}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {displayName}
            </div>
            <div style={{
              fontSize: '0.68rem',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}>
              {isOwner ? 'System Owner' : 'Operator'}
            </div>
          </div>
        </Link>
      </div>

      {/* Bottom Actions */}
      <div className="sidebar-bottom">
        <Link href="/profile" onClick={onClose} className={`sidebar-link ${pathname === '/profile' ? 'active' : ''}`}>
          <UserIcon size={17} style={{ color: pathname === '/profile' ? 'var(--gold)' : 'inherit' }} />
          <span>Profile {isOwner && '& Admin'}</span>
        </Link>
        <button
          type="button"
          className="sidebar-link sidebar-logout"
          onClick={async () => {
            onClose?.();
            await logout();
          }}
        >
          <LogOut size={17} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
