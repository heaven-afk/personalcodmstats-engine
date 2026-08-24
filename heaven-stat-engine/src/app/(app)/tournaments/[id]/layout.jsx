'use client';
import { useState, useEffect, createContext, useContext } from 'react';
import { useParams, useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getTournament } from '@/lib/firestore/tournaments';
import { formatEventDates } from '@/lib/utils/dateUtils';
import { setupTournamentPresence } from '@/lib/presence';
import TournamentSubNav from '@/components/layout/TournamentSubNav';
import ActiveCollaborators from '@/components/ui/ActiveCollaborators';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import toast from 'react-hot-toast';

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
  const pathname = usePathname();
  const { user, profile, isOwner, loading: authLoading } = useAuth();
  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const t = await getTournament(id);
    setTournament(t);
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [id]);

  // Track live real-time presence within this tournament
  useEffect(() => {
    if (!id || !user?.uid) return;
    const cleanup = setupTournamentPresence(id, user, profile, pathname);
    return cleanup;
  }, [id, user?.uid, user?.email, profile?.username, profile?.avatarUrl, profile?.role, pathname]);

  // Redirect away only if tournament was deleted or doesn't exist
  useEffect(() => {
    if (!loading && !authLoading) {
      if (!tournament) {
        toast.error('Tournament not found');
        router.replace('/tournaments');
      }
    }
  }, [loading, authLoading, tournament, router]);

  if (loading || authLoading) return <LoadingSpinner size="lg" />;
  if (!tournament) return <LoadingSpinner size="lg" />; // Brief spinner while redirecting

  const editors = tournament.editorUids || [];
  const userEmail = user?.email?.toLowerCase();
  const isCreator = (tournament.createdBy && tournament.createdBy === user?.uid) ||
    (userEmail && tournament.creatorEmail && tournament.creatorEmail.toLowerCase() === userEmail);
  const isAssignedEditor = editors.some(
    e => e === user?.uid || (userEmail && e.toLowerCase() === userEmail)
  );

  const canEdit = Boolean(isOwner || isCreator || isAssignedEditor);
  const canManageEditors = Boolean(isOwner || isCreator);

  const dateRange = formatEventDates(tournament.eventStartDate, tournament.eventEndDate);

  return (
    <div>
      {/* Tournament header with active collaborators */}
      <div className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <div>
          <h1 className="page-title">{tournament.name}</h1>
          <p className="page-subtitle">
            {[
              tournament.season ? `Season ${tournament.season}` : null,
              dateRange,
              tournament.status
            ].filter(Boolean).join(' · ')}
          </p>
        </div>

        {/* Live Active Collaborators PFP Stack */}
        <ActiveCollaborators tournamentId={id} />
      </div>

      <TournamentSubNav tournamentId={id} canEdit={canEdit} />

      {/* Pass tournament + refresh + permissions to children via context */}
      <TournamentContext.Provider value={{ tournament, setTournament, refresh, canEdit, canManageEditors }}>
        {children}
      </TournamentContext.Provider>
    </div>
  );
}
