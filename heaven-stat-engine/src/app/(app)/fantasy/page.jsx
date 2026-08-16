'use client';

import { Coins, Sparkles, Trophy, Users, Shield, Zap, Flame } from 'lucide-react';

export default function FantasyPage() {
  return (
    <div>
      {/* Page Header */}
      <div className="page-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Coins size={24} style={{ color: 'var(--gold)' }} />
            BR Fantasy
          </h1>
          <p className="page-subtitle">
            Player pricing and fantasy scoring — full contest experience launching soon
          </p>
        </div>
      </div>

      {/* Hero / Coming Soon Container */}
      <div
        className="card"
        style={{
          padding: '48px 32px',
          textAlign: 'center',
          background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.08) 0%, rgba(15, 23, 42, 0.95) 100%)',
          border: '1px solid rgba(201, 168, 76, 0.3)',
          borderRadius: 16,
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
          position: 'relative',
          overflow: 'hidden',
          maxWidth: 860,
          margin: '0 auto 32px auto',
        }}
      >
        {/* Subtle decorative glow orb */}
        <div
          style={{
            position: 'absolute',
            top: '-50px',
            right: '-50px',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(201, 168, 76, 0.25) 0%, rgba(201, 168, 76, 0) 70%)',
            pointerEvents: 'none',
            filter: 'blur(30px)',
          }}
        />

        {/* Icon Emblem */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            background: 'linear-gradient(135deg, rgba(201, 168, 76, 0.25) 0%, rgba(201, 168, 76, 0.05) 100%)',
            border: '1.5px solid var(--border-gold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px auto',
            boxShadow: '0 8px 24px rgba(201, 168, 76, 0.2)',
          }}
        >
          <Coins size={36} style={{ color: 'var(--gold)' }} />
        </div>

        {/* Badge */}
        <div style={{ marginBottom: 14 }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: 'var(--gold)',
              background: 'rgba(201, 168, 76, 0.15)',
              border: '1px solid rgba(201, 168, 76, 0.35)',
              padding: '4px 12px',
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Sparkles size={13} /> Slayers Contest Engine • Coming Soon
          </span>
        </div>

        {/* Title & Description */}
        <h2
          style={{
            fontSize: '1.85rem',
            fontWeight: 900,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
            marginBottom: 12,
          }}
        >
          Slayer BR Fantasy League
        </h2>

        <p
          style={{
            fontSize: '0.95rem',
            color: 'var(--text-secondary)',
            maxWidth: 580,
            margin: '0 auto 28px auto',
            lineHeight: 1.6,
          }}
        >
          Build your dream roster within the 100-credit salary cap. Compete with career-calibrated player pricing, live match multiplier boosts, and real-time leaderboard tracking.
        </p>

        {/* Feature Previews */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 16,
            textAlign: 'left',
            marginTop: 32,
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: 28,
          }}
        >
          <div
            style={{
              padding: '16px 18px',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Coins size={16} style={{ color: 'var(--gold)' }} />
              <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>100-Credit Budget</strong>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Draft a 4-player squad dynamically priced from 10 to 40 credits based on career KPM and rolling form.
            </p>
          </div>

          <div
            style={{
              padding: '16px 18px',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Flame size={16} style={{ color: '#F87171' }} />
              <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Career Form Calibration</strong>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Stable historical kills combined with decayed recent momentum ensure balanced and competitive player pricing.
            </p>
          </div>

          <div
            style={{
              padding: '16px 18px',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Trophy size={16} style={{ color: 'var(--cyan)' }} />
              <strong style={{ fontSize: '0.88rem', color: 'var(--text-primary)' }}>Live Contest Scoring</strong>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
              Real-time point updates as tournament matches conclude with Captain multiplier bonuses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
