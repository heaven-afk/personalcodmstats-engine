'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Wordmark from '@/components/ui/Wordmark';
import {
  LayoutDashboard, Trophy, Users, Shield, BarChart3, Settings, LogOut, GitCompare, FlaskConical, X
} from 'lucide-react';

const NAV = [
  { href: '/dashboard',   label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/players',     label: 'Players',     icon: Users },
  { href: '/teams',       label: 'Teams',       icon: Shield },
  { href: '/comparison',  label: 'Comparison',  icon: GitCompare },
  { href: '/rankings',    label: 'Rankings',    icon: BarChart3 },
  { href: '/simulate',    label: 'Simulate',    icon: FlaskConical },
];

export default function Sidebar({ mobileOpen, onClose }) {
  const pathname = usePathname();
  const { logout } = useAuth();

  const isActive = (href) => {
    return pathname.startsWith(href);
  };

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
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV.map(({ href, label, icon: Icon }) => {
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
        <Link href="/settings" onClick={onClose} className={`sidebar-link ${pathname === '/settings' ? 'active' : ''}`}>
          <Settings size={17} style={{ color: pathname === '/settings' ? 'var(--gold)' : 'inherit' }} />
          <span>Settings</span>
        </Link>
        <button className="sidebar-link sidebar-logout" onClick={() => { onClose?.(); logout(); }}>
          <LogOut size={17} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
