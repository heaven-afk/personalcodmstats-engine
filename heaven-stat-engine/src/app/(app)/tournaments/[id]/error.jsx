'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react';

export default function TournamentError({ error, reset }) {
  useEffect(() => {
    console.error('Tournament subpage error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
    }}>
      <div style={{
        maxWidth: 520,
        width: '100%',
        background: 'var(--bg-card, #0f172a)',
        border: '1px solid rgba(239, 68, 68, 0.35)',
        borderRadius: 14,
        padding: 28,
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.15)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          color: '#ef4444',
        }}>
          <AlertTriangle size={28} />
        </div>

        <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#fff', marginBottom: 8 }}>
          Tournament Data Error
        </h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', marginBottom: 20, lineHeight: 1.5 }}>
          {error?.message || 'Failed to render tournament information. This may be due to missing configuration or network disconnect.'}
        </p>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => reset()}
            className="btn btn-primary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            <RefreshCw size={15} />
            <span>Reload Section</span>
          </button>

          <Link
            href="/tournaments"
            className="btn btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              fontWeight: 700,
              fontSize: '0.85rem',
            }}
          >
            <ArrowLeft size={15} />
            <span>Back to Tournaments</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
