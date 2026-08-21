'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import Wordmark from '@/components/ui/Wordmark';
import { Mail, Lock, Eye, EyeOff, AlertCircle, ShieldAlert } from 'lucide-react';

function LoginForm() {
  const { login, isDemoMode, authError } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectParam = searchParams.get('redirect');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isLockedOut, setIsLockedOut] = useState(false);

  const displayError = errorMsg || authError;

  const getDestination = () => {
    if (redirectParam && redirectParam.startsWith('/') && !redirectParam.startsWith('//')) {
      return redirectParam;
    }
    return '/dashboard';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setErrorMsg('');
    setIsLockedOut(false);

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Server-side Rate Limit Check
    try {
      const checkRes = await fetch('/api/auth/rate-limit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check', email: normalizedEmail }),
      });

      if (checkRes.status === 403 || !checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.locked) {
          setIsLockedOut(true);
          setErrorMsg(checkData.message || 'Account temporarily locked due to too many failed attempts.');
          setLoading(false);
          return;
        }
      }
    } catch (checkErr) {
      console.warn('Rate limit pre-check skipped/errored:', checkErr);
    }

    // 2. Perform Login Attempt
    try {
      await login(email, password);

      // 3. Reset Rate Limit Counter on Success
      try {
        await fetch('/api/auth/rate-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reset', email: normalizedEmail }),
        });
      } catch {}

      router.replace(getDestination());
    } catch (err) {
      // 4. Record Failure on Server
      try {
        const failRes = await fetch('/api/auth/rate-limit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'record-failure', email: normalizedEmail }),
        });
        const failData = await failRes.json();
        if (failData.locked) {
          setIsLockedOut(true);
          setErrorMsg(failData.message || 'Too many failed login attempts. Account temporarily locked.');
          return;
        }
      } catch {}

      setErrorMsg(err.message || 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
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
              setEmail('demo@example.com');
              setPassword('password');
              login('demo@example.com', 'password').then(() => router.replace(getDestination()));
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
      {displayError && (
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          background: isLockedOut ? 'rgba(239, 68, 68, 0.16)' : 'rgba(239, 68, 68, 0.1)',
          border: `1px solid ${isLockedOut ? 'rgba(239, 68, 68, 0.5)' : 'rgba(239, 68, 68, 0.3)'}`,
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 20,
          color: '#ef4444',
          fontSize: '0.82rem',
          lineHeight: 1.4,
        }}>
          {isLockedOut ? (
            <ShieldAlert size={18} style={{ flexShrink: 0, marginTop: 1, color: '#ef4444' }} />
          ) : (
            <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          )}
          <span>{displayError}</span>
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
              placeholder="you@example.com"
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
  );
}

export default function LoginPage() {
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

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
