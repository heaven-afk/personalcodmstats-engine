'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Unhandled application error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      background: 'var(--bg-primary, #090d16)',
      color: 'var(--text-primary, #f1f5f9)',
      fontFamily: 'var(--font-inter, sans-serif)',
    }}>
      <div style={{
        maxWidth: 480,
        width: '100%',
        background: 'var(--bg-card, #0f172a)',
        border: '1px solid rgba(239, 68, 68, 0.35)',
        borderRadius: 14,
        padding: 28,
        textAlign: 'center',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.1)',
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
          <AlertCircle size={28} />
        </div>

        <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', marginBottom: 8 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #94a3b8)', marginBottom: 20, lineHeight: 1.5 }}>
          {error?.message || 'An unexpected error occurred while loading this page.'}
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
            <span>Try Again</span>
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
            <Home size={15} />
            <span>Tournaments Hub</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
