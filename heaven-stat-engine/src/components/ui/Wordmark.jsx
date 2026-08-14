'use client';

export default function Wordmark({ size = 'md', className = '', showText = true }) {
  const isSm = size === 'sm';
  const isLg = size === 'lg';

  const iconDim = isSm ? 34 : isLg ? 52 : 40;
  const titleSize = isSm ? '1.05rem' : isLg ? '1.75rem' : '1.35rem';
  const subSize = isSm ? '0.62rem' : isLg ? '0.78rem' : '0.70rem';

  return (
    <div className={`wordmark-container ${className}`} style={{ display: 'inline-flex', alignItems: 'center', gap: isSm ? 10 : 14 }}>
      <div
        className="wordmark-icon-wrap"
        style={{
          width: iconDim,
          height: iconDim,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          filter: 'drop-shadow(0 4px 12px rgba(201, 168, 76, 0.35))',
        }}
      >
        <img
          src="/brand/heaven_stat_engine_icon.png"
          alt="Heaven Stat Engine"
          width={iconDim}
          height={iconDim}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{
            fontSize: titleSize,
            fontWeight: 900,
            color: '#FFFFFF',
            letterSpacing: '-0.02em',
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
      )}
    </div>
  );
}

