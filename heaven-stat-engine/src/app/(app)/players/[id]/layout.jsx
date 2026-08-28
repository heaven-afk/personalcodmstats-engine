'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { getPlayer } from '@/lib/firestore/registry';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

// ─── Context ──────────────────────────────────────────────────────────────────
export const PlayerContext = createContext(null);

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be inside PlayerLayout');
  return ctx;
}

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function PlayerLayout({ children }) {
  const { id } = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const { isOwner, loading: authLoading } = useAuth();

  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const p = await getPlayer(id);
        if (!p) {
          toast.error('Player not found');
          router.replace('/players');
          return;
        }
        setPlayer(p);
      } catch (err) {
        toast.error('Error loading player: ' + err.message);
        router.replace('/players');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, router]);

  // Redirect operators away from /analysis route
  useEffect(() => {
    if (!authLoading && !loading && !isOwner) {
      const analysisPath = `/players/${id}/analysis`;
      if (pathname === analysisPath || pathname.startsWith(analysisPath + '/')) {
        router.replace(`/players/${id}`);
      }
    }
  }, [authLoading, loading, isOwner, pathname, id, router]);

  if (loading || authLoading) return <LoadingSpinner size="lg" />;
  if (!player) return <LoadingSpinner size="lg" />;

  const base = `/players/${id}`;

  const tabs = [
    { key: 'overview', label: 'Overview', href: base },
    // Analysis tab only visible to owners
    ...(isOwner ? [{ key: 'analysis', label: 'Analysis', href: `${base}/analysis` }] : []),
  ];

  const isActive = (tab) => {
    if (tab.key === 'overview') return pathname === base;
    return pathname.startsWith(tab.href);
  };

  return (
    <PlayerContext.Provider value={{ player, setPlayer }}>
      {/* Player Sub Nav */}
      <div className="tournament-subnav" style={{ marginBottom: 20 }}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`tournament-subnav-tab ${isActive(tab) ? 'active' : ''}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {children}
    </PlayerContext.Provider>
  );
}
