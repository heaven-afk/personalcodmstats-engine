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
  { key: 'extraction',  label: 'Extraction',    href: '/extraction' },
  { key: 'import',      label: 'Import',        href: '/import' },
];

export default function TournamentSubNav({ tournamentId }) {
  const pathname = usePathname();
  const base = `/tournaments/${tournamentId}`;

  const isActive = (tab) => {
    if (tab.href === '') return pathname === base;
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
