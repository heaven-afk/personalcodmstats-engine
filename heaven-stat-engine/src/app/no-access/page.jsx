'use client';
import Link from 'next/link';
import Wordmark from '@/components/ui/Wordmark';
import { ShieldX, ArrowLeft, Mail } from 'lucide-react';

export default function NoAccessPage() {
  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'var(--bg-app, #0B0E14)',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      overflow: 'hidden',
    }}>
      {/* Background Radial Vignette */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(circle at 50% 45%, rgba(239, 68, 68, 0.08) 0%, rgba(13,27,42,0) 70%)',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'var(--bg-card, #121824)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 16,
          padding: '48px 40px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), 0 0 30px rgba(239, 68, 68, 0.05)',
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
        }}
      >
        {/* Wordmark */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <Wordmark size="lg" />
        </div>

        {/* Shield Icon */}
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.12)',
          border: '1px solid rgba(239, 68, 68, 0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 20px',
          boxShadow: '0 0 20px rgba(239, 68, 68, 0.2)',
        }}>
          <ShieldX size={32} style={{ color: '#ef4444' }} />
        </div>

        <h1 style={{
          fontSize: '1.4rem',
          fontWeight: 800,
          color: '#FFFFFF',
          marginBottom: 10,
          letterSpacing: '-0.01em',
        }}>
          Access Restricted
        </h1>

        <p style={{
          fontSize: '0.88rem',
          color: '#94A3B8',
          lineHeight: 1.6,
          marginBottom: 24,
        }}>
          You do not have access to the Heaven Stat Engine platform. This system is private and requires an authorized invitation.
        </p>

        <div style={{
          padding: '14px 16px',
          borderRadius: 10,
          background: 'rgba(201, 168, 76, 0.08)',
          border: '1px solid rgba(201, 168, 76, 0.25)',
          fontSize: '0.82rem',
          color: 'var(--gold, #C9A84C)',
          marginBottom: 28,
          lineHeight: 1.5,
        }}>
          If you believe this is an error, please contact the tournament administrator to request platform access.
        </div>

        <Link
          href="/login"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            width: '100%',
            padding: '12px 20px',
            background: 'var(--bg-alt-row, #1a2234)',
            color: '#FFFFFF',
            border: '1px solid var(--border-md, rgba(255,255,255,0.15))',
            borderRadius: 8,
            fontSize: '0.88rem',
            fontWeight: 700,
            textDecoration: 'none',
            transition: 'background 0.2s, border-color 0.2s',
          }}
          className="hover:border-gold"
        >
          <ArrowLeft size={16} /> Return to Sign In
        </Link>
      </div>
    </div>
  );
}
