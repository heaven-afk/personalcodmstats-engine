'use client';
import { useUserPresence } from '@/hooks/usePresence';
import { getOptimizedImageUrl } from '@/lib/utils/cloudinary';

const SIZES = {
  xs: { box: 24, font: '0.65rem', ring: 7, ringBorder: 1.5 },
  sm: { box: 32, font: '0.75rem', ring: 9, ringBorder: 2 },
  md: { box: 40, font: '0.9rem', ring: 11, ringBorder: 2 },
  lg: { box: 50, font: '1.1rem', ring: 13, ringBorder: 2.5 },
  xl: { box: 64, font: '1.4rem', ring: 15, ringBorder: 3 },
  '2xl': { box: 84, font: '1.8rem', ring: 18, ringBorder: 3 },
};

export default function UserAvatar({
  src,
  name = 'User',
  uid,
  status: explicitStatus,
  size = 'md',
  showPresence = true,
  className = '',
  style = {},
}) {
  const presence = useUserPresence(uid);
  const isOnline = explicitStatus ? explicitStatus === 'online' : (uid ? presence.isOnline : false);

  const dim = SIZES[size] || SIZES.md;
  const initial = (name || '?').trim()[0]?.toUpperCase() || '?';
  const optimizedSrc = src ? getOptimizedImageUrl(src, dim.box * 2, dim.box * 2) : null;

  return (
    <div
      className={`user-avatar-container ${className}`}
      style={{
        position: 'relative',
        width: dim.box,
        height: dim.box,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {/* Avatar Image / Fallback Initials */}
      {optimizedSrc ? (
        <img
          src={optimizedSrc}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            objectFit: 'cover',
            border: isOnline ? '2px solid rgba(34, 197, 94, 0.6)' : '2px solid var(--border-gold)',
            boxShadow: isOnline ? '0 0 10px rgba(34, 197, 94, 0.35)' : '0 0 10px rgba(201, 168, 76, 0.15)',
            transition: 'border-color 0.25s, box-shadow 0.25s',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(201,168,76,0.25), rgba(59,130,246,0.2))',
            border: isOnline ? '2px solid rgba(34, 197, 94, 0.6)' : '2px solid var(--border-gold)',
            boxShadow: isOnline ? '0 0 10px rgba(34, 197, 94, 0.35)' : '0 0 10px rgba(201, 168, 76, 0.15)',
            color: 'var(--gold)',
            fontWeight: 800,
            fontSize: dim.font,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            userSelect: 'none',
            transition: 'border-color 0.25s, box-shadow 0.25s',
          }}
        >
          {initial}
        </div>
      )}

      {/* Presence Dot Ring */}
      {showPresence && (uid || explicitStatus !== undefined) && (
        <span
          title={isOnline ? 'Online' : 'Offline'}
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: dim.ring,
            height: dim.ring,
            borderRadius: '50%',
            background: isOnline ? '#22c55e' : '#64748b',
            border: `${dim.ringBorder}px solid var(--bg-card, #0f172a)`,
            boxShadow: isOnline ? '0 0 6px #22c55e' : 'none',
            transition: 'background-color 0.3s, box-shadow 0.3s',
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
}
