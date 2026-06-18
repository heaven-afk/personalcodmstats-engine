'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Zap, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login, isDemoMode } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      toast.error('Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Background grid */}
      <div className="login-bg-grid" />

      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <div className="login-logo-icon">
            <Zap size={28} className="text-black" />
          </div>
          <div>
            <h1 className="login-logo-title">Heaven Stat Engine</h1>
            <p className="login-logo-sub">Personal Tournament Platform</p>
          </div>
        </div>

        {isDemoMode && (
          <div style={{
            background: 'rgba(201,168,76,0.1)',
            border: '1px solid rgba(201,168,76,0.2)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
            fontSize: '0.8rem',
            color: 'var(--gold)',
            lineHeight: 1.4
          }}>
            <strong>Sandbox Demo Mode:</strong> Firebase is not configured yet. You can sign in instantly with any email/password, or click below for instant access:
            <button
              type="button"
              onClick={() => {
                setEmail('admin@example.com');
                setPassword('password');
                login('admin@example.com', 'password').then(() => router.replace('/'));
              }}
              style={{
                display: 'block',
                marginTop: 8,
                background: 'var(--gold)',
                color: '#000',
                border: 'none',
                borderRadius: 4,
                padding: '4px 10px',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.75rem'
              }}
            >
              Quick Demo Login
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-field">
            <label className="form-label">Email</label>
            <div className="input-wrap">
              <Mail size={16} className="input-icon" />
              <input
                id="login-email"
                type="email"
                className="form-input with-icon"
                placeholder="owner@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Password</label>
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

        <p className="login-footer">
          Heaven Stat Engine · Private Access Only
        </p>
      </div>
    </div>
  );
}
