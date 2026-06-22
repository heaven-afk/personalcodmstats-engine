'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Trophy, Users, Shield, Swords, BarChart3, Settings, LogOut, Zap, GitCompare, FlaskConical
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

export default function Sidebar() {
  const pathname = usePathname();
  const { logout } = useAuth();

  const isActive = (href) => {
    return pathname.startsWith(href);
  };

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Zap size={20} className="text-black" />
        </div>
        <div>
          <div className="sidebar-logo-title">Heaven</div>
          <div className="sidebar-logo-sub">Stat Engine</div>
        </div>
      </div>

      <div className="sidebar-divider" />

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`sidebar-link ${isActive(href) ? 'active' : ''}`}
          >
            <Icon size={17} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-spacer" />
      <div className="sidebar-divider" />

      {/* Bottom */}
      <div className="sidebar-bottom">
        <Link href="/settings" className={`sidebar-link ${pathname === '/settings' ? 'active' : ''}`}>
          <Settings size={17} />
          <span>Settings</span>
        </Link>
        <button className="sidebar-link sidebar-logout" onClick={logout}>
          <LogOut size={17} />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
