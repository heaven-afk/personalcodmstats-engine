'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getTournament } from '@/lib/firestore/tournaments';
import TournamentSubNav from '@/components/layout/TournamentSubNav';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

// Context so child pages can read the tournament
export const TournamentContext = createContext(null);
export function useTournament() {
  const ctx = useContext(TournamentContext);
  if (!ctx) throw new Error('useTournament must be inside TournamentLayout');
  return ctx;
}

export default function TournamentLayout({ children }) {
  const { id } = useParams();
  const router = useRouter();
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const t = await getTournament(id);
    setTournament(t);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [id]);

  // Redirect away if tournament was deleted or doesn't exist
  useEffect(() => {
    if (!loading && !tournament) {
      router.replace('/tournaments');
    }
  }, [loading, tournament]);

  if (loading) return <LoadingSpinner size="lg" />;
  if (!tournament) return <LoadingSpinner size="lg" />; // Brief spinner while redirecting

  return (
    <div>
      {/* Tournament header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-subtitle">Season {tournament.season} · {tournament.status}</p>
        </div>
      </div>

      <TournamentSubNav tournamentId={id} />

      {/* Pass tournament + refresh to children via a context trick */}
      <TournamentContext.Provider value={{ tournament, setTournament, refresh }}>
        {children}
      </TournamentContext.Provider>
    </div>
  );
}
