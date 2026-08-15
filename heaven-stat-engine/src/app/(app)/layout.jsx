'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/layout/Sidebar';
import Wordmark from '@/components/ui/Wordmark';
import UserAvatar from '@/components/ui/UserAvatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Menu } from 'lucide-react';

const OWNER_ONLY_PREFIXES = [
  '/comparison',
  '/analysis',
  '/simulate',
  '/rankings',
  '/settings',
  '/dashboard'
];

export default function AppLayout({ children }) {
  const { user, profile, displayName, loading, isOperator, role, isOwner } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
      return;
    }

    if (!loading && isOperator) {
      const isRestricted = OWNER_ONLY_PREFIXES.some(prefix => pathname.startsWith(prefix));
      if (isRestricted) {
        router.replace('/tournaments');
      }
    }
  }, [user, loading, isOperator, pathname, router]);

  if (loading) return (
    <div className="full-page-center">
      <LoadingSpinner size="lg" text="Loading Heaven Stat Engine..." />
    </div>
  );

  if (!user) return null;

  const closeSidebar = () => setMobileOpen(false);
  const toggleSidebar = () => setMobileOpen(prev => !prev);

  return (
    <div className="app-shell">
      {/* Mobile Topbar */}
      <header className="mobile-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button 
            className="mobile-nav-toggle"
            onClick={toggleSidebar}
            aria-label="Toggle navigation"
          >
            <Menu size={18} />
          </button>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center' }}>
            <Wordmark size="sm" />
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {role && (
            <span style={{
              fontSize: '0.62rem',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '2px 6px',
              borderRadius: 4,
              fontWeight: 700,
              background: isOwner ? 'rgba(201,168,76,0.15)' : 'rgba(59,130,246,0.15)',
              color: isOwner ? 'var(--gold)' : '#60a5fa',
              border: `1px solid ${isOwner ? 'rgba(201,168,76,0.3)' : 'rgba(59,130,246,0.3)'}`,
            }}>
              {isOwner ? '👑' : '🛠️'}
            </span>
          )}
          <Link href="/profile" style={{ display: 'flex', alignItems: 'center' }} title="Profile & Settings">
            <UserAvatar
              src={profile?.avatarUrl}
              name={displayName}
              uid={user?.uid}
              size="sm"
              showPresence={true}
            />
          </Link>
        </div>
      </header>

      {/* Sidebar Backdrop Overlay */}
      <div 
        className={`sidebar-backdrop ${mobileOpen ? 'mobile-open' : ''}`}
        onClick={closeSidebar}
      />

      <Sidebar mobileOpen={mobileOpen} onClose={closeSidebar} />
      
      <main className="app-main">
        <div className="app-content">
          {children}
        </div>
      </main>
    </div>
  );
}
