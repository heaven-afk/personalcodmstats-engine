'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Wordmark from '@/components/ui/Wordmark';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const { login, isDemoMode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setErrorMsg('');
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setErrorMsg(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100vw',
      background: 'var(--bg-app)',
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
        background: 'radial-gradient(circle at 50% 45%, rgba(201,168,76,0.06) 0%, rgba(13,27,42,0) 70%)',
        pointerEvents: 'none',
      }} />

      {/* Login Container Card */}
      <div
        className="login-card-animated"
        style={{
          width: '100%',
          maxWidth: 440,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-md)',
          borderRadius: 16,
          padding: '48px 40px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), 0 0 30px rgba(201, 168, 76, 0.04)',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Header Wordmark */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 36 }}>
          <Wordmark size="lg" />
        </div>

        {isDemoMode && (
          <div style={{
            background: 'rgba(201,168,76,0.1)',
            border: '1px solid rgba(201,168,76,0.25)',
            borderRadius: 10,
            padding: 14,
            marginBottom: 24,
            fontSize: '0.8rem',
            color: 'var(--gold)',
            lineHeight: 1.4
          }}>
            <strong>Sandbox Demo Mode:</strong> Firebase is not configured yet. You can sign in instantly with any email/password, or click below:
            <button
              type="button"
              onClick={() => {
                setEmail('ogadizion01@gmail.com');
                setPassword('password');
                login('ogadizion01@gmail.com', 'password').then(() => router.replace('/'));
              }}
              style={{
                display: 'block',
                marginTop: 10,
                width: '100%',
                background: 'var(--gold)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                padding: '6px 12px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.78rem'
              }}
            >
              Quick Demo Login
            </button>
          </div>
        )}

        {/* Error Alert Message Box */}
        {errorMsg && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 20,
            color: '#ef4444',
            fontSize: '0.82rem',
            lineHeight: 1.4,
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="form-field">
            <label className="form-label" style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Email Address
            </label>
            <div className="input-wrap">
              <Mail size={16} className="input-icon" />
              <input
                id="login-email"
                type="email"
                className="form-input with-icon"
                placeholder="ogadizion01@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label" style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Password
            </label>
            <div className="input-wrap">
              <Lock size={16} className="input-icon" />
              <input
                id="login-password"
                type={showPw ? 'text' : 'password'}
                className="form-input with-icon"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="input-eye"
                onClick={() => setShowPw((v) => !v)}
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button
            id="login-submit"
            type="submit"
            className="btn-primary-full"
            disabled={loading}
            style={{
              marginTop: 8,
              padding: '12px 20px',
              fontSize: '0.9rem',
              fontWeight: 700,
              borderRadius: 8,
            }}
          >
            {loading ? (
              <span className="btn-loading">
                <span className="spinner-sm-inline" />
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <p style={{
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          marginTop: 28,
          marginBottom: 0
        }}>
          Heaven Stat Engine · Private Access Only
        </p>
      </div>
    </div>
  );
}
