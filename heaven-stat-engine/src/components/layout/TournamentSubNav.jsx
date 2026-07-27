'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useParams } from 'next/navigation';

const TABS = [
  { key: 'overview',     label: 'Overview',      href: '' },
  { key: 'register',     label: 'Register',      href: '/register' },
  { key: 'player-entry', label: 'Player Entry',  href: '/player-entry' },
  { key: 'team-entry',   label: 'Team Entry',    href: '/team-entry' },
  { key: 'standings',    label: 'Standings',     href: '/standings' },
  { key: 'analytics',   label: 'Analytics',     href: '/analytics' },
  { key: 'deep-analysis', label: 'Deep Analysis', href: '/analytics?tab=deep' },
  { key: 'extraction',  label: 'Extraction',    href: '/extraction' },
  { key: 'import',      label: 'Import',        href: '/import' },
  { key: 'clean-duplicates', label: 'Clean Duplicates', href: '/clean-duplicates' },
];

export default function TournamentSubNav({ tournamentId }) {
  const pathname = usePathname();
  const base = `/tournaments/${tournamentId}`;

  const isActive = (tab) => {
    if (tab.href === '') return pathname === base;
    if (tab.key === 'deep-analysis') {
      return pathname === `${base}/analytics` && typeof window !== 'undefined' && window.location.search.includes('tab=deep');
    }
    if (tab.key === 'analytics') {
      return pathname === `${base}/analytics` && (typeof window === 'undefined' || !window.location.search.includes('tab=deep'));
    }
    return pathname.startsWith(`${base}${tab.href}`);
  };

  return (
    <div className="tournament-subnav">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`${base}${tab.href}`}
          className={`tournament-subnav-tab ${isActive(tab) ? 'active' : ''}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
