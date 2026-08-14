'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Wordmark from '@/components/ui/Wordmark';
import {
  LayoutDashboard, Trophy, Users, Shield, BarChart3, Settings, LogOut, GitCompare, FlaskConical, Sparkles, X
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/players',     label: 'Players',     icon: Users },
  { href: '/teams',       label: 'Teams',       icon: Shield },
  { href: '/comparison',  label: 'Comparison',  icon: GitCompare },
  { href: '/rankings',    label: 'Rankings',    icon: BarChart3 },
  { href: '/analysis',    label: 'Deep Analysis', icon: Sparkles },
  { href: '/simulate',    label: 'Simulate',    icon: FlaskConical },
];

export default function Sidebar({ mobileOpen, onClose }) {
  const pathname = usePathname();
  const { logout, isOwner, isOperator, role } = useAuth();

  const isActive = (href) => {
    return pathname.startsWith(href);
  };

  // Role-gate navigation
  const visibleNav = NAV.filter(item => {
    if (isOperator) {
      return item.href === '/tournaments' || item.href === '/players' || item.href === '/teams';
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

      {/* Bottom */}
      <div className="sidebar-bottom">
        {isOwner && (
          <Link href="/settings" onClick={onClose} className={`sidebar-link ${pathname === '/settings' ? 'active' : ''}`}>
            <Settings size={17} style={{ color: pathname === '/settings' ? 'var(--gold)' : 'inherit' }} />
            <span>Settings</span>
          </Link>
        )}
        <button className="sidebar-link sidebar-logout" onClick={() => { onClose?.(); logout(); }}>
          <LogOut size={17} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
