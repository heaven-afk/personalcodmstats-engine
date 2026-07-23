'use client';
import { Zap } from 'lucide-react';

export default function Wordmark({ size = 'md', className = '' }) {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const iconSize = isSm ? 18 : isLg ? 28 : 22;
  const titleSize = isSm ? '1rem' : isLg ? '1.75rem' : '1.25rem';
  const subSize = isSm ? '0.62rem' : isLg ? '0.75rem' : '0.68rem';

  return (
    <div className={`wordmark-container ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: isSm ? 10 : 14 }}>
      <div className="wordmark-icon-wrap" style={{
        width: isSm ? 32 : isLg ? 48 : 38,
        height: isSm ? 32 : isLg ? 48 : 38,
        borderRadius: isSm ? 7 : 10,
        background: 'linear-gradient(135deg, var(--gold-light) 0%, var(--gold) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 14px rgba(201, 168, 76, 0.25)',
        flexShrink: 0,
      }}>
        <Zap size={iconSize} style={{ color: '#000', fill: '#000' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{
          fontSize: titleSize,
          fontWeight: 900,
          color: '#FFFFFF',
          letterSpacing: '-0.03em',
          lineHeight: 1.1,
          fontFamily: 'var(--font)',
          display: 'flex',
          alignItems: 'center',
          gap: 6
        }}>
          HEAVEN
          <span style={{
            display: 'inline-block',
            width: isSm ? 4 : 6,
            height: isSm ? 4 : 6,
            borderRadius: '50%',
            background: 'var(--gold)',
            boxShadow: '0 0 8px var(--gold)'
          }} />
        </div>
        <div style={{
          fontSize: subSize,
          fontWeight: 700,
          color: 'var(--gold)',
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          lineHeight: 1,
          marginTop: 3,
        }}>
          STAT ENGINE
        </div>
      </div>
    </div>
  );
}
