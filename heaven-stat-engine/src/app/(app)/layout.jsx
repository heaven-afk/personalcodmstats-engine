'use client';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Menu, Zap } from 'lucide-react';

export default function AppLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

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
      <header className="mobile-topbar" style={{ display: 'none' }}>
        <div className="mobile-logo">
          <div className="mobile-logo-icon">
            <Zap size={16} className="text-black" />
          </div>
          <span className="mobile-logo-title">Heaven</span>
        </div>
        <button 
          className="mobile-nav-toggle"
          onClick={toggleSidebar}
          aria-label="Toggle navigation"
        >
          <Menu size={20} />
        </button>
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
