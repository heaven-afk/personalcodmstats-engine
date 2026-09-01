'use client';
import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { fetchOcrLogs, computeOcrStats } from '@/lib/firestore/ocrLogs';
import {
  Activity, CheckCircle, XCircle, Clock, Key, Zap,
  RefreshCw, TrendingUp, DollarSign, BarChart2, Shield
} from 'lucide-react';

const PERIODS = [
  { label: 'Today', days: 1 },
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
];

function StatCard({ icon: Icon, label, value, sub, color = 'var(--accent)' }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <Icon size={13} />
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

function ModelBar({ model, count, total }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const shortModel = model.replace('gemini-', '').replace('-flash', '⚡').replace('-pro', '★');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
        <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{shortModel}</span>
        <span style={{ color: 'var(--text-muted)' }}>{count} ({pct}%)</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3,
          background: 'linear-gradient(90deg, var(--accent), #7c3aed)',
          transition: 'width 0.6s ease',
        }} />
      </div>
    </div>
  );
}

function RecentLogsTable({ logs }) {
  const recent = logs.slice(0, 20);
  if (!recent.length) return <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No logs yet.</p>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {['Time', 'Model', 'Key', 'Type', 'Lobby', 'Status', 'Latency'].map(h => (
              <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {recent.map((log, i) => {
            const ts = log.createdAt?.toDate?.() || new Date();
            return (
              <tr key={log.id || i} style={{ borderBottom: '1px solid var(--border)', opacity: 0.9 }}>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{ts.toLocaleTimeString()}</td>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{log.model?.replace('gemini-', '') || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    padding: '2px 7px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 700,
                    background: log.keyIndex === 0 ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.15)',
                    color: log.keyIndex === 0 ? '#818cf8' : '#34d399',
                  }}>Key {(log.keyIndex ?? 0) + 1}</span>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--text-secondary)', textTransform: 'capitalize' }}>{log.type || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>#{log.lobbyNumber || '—'}</td>
                <td style={{ padding: '8px 12px' }}>
                  {log.success
                    ? <span style={{ color: '#34d399', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={12} /> OK</span>
                    : <span style={{ color: '#f87171', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={12} /> {log.errorCode || 'Fail'}</span>
                  }
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{log.latencyMs ? `${(log.latencyMs / 1000).toFixed(1)}s` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminPage() {
  const { user, isOwner, loading } = useAuth();
  const router = useRouter();

  const [period, setPeriod] = useState(1);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  // Guard: redirect non-owners
  useEffect(() => {
    if (!loading && (!user || !isOwner)) {
      router.replace('/dashboard');
    }
  }, [user, isOwner, loading, router]);

  const loadLogs = useCallback(async () => {
    setFetching(true);
    try {
      const data = await fetchOcrLogs(period);
      setLogs(data);
      setStats(computeOcrStats(data));
      setLastRefresh(new Date());
    } finally {
      setFetching(false);
    }
  }, [period]);

  useEffect(() => {
    if (isOwner) loadLogs();
  }, [loadLogs, isOwner]);

  if (loading || !isOwner) return null;

  const successColor = stats?.successRate >= 90 ? '#34d399' : stats?.successRate >= 70 ? '#fbbf24' : '#f87171';

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Shield size={20} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Admin Dashboard</h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>OCR Usage & API Health Monitor</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: 4, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }}>
            {PERIODS.map(p => (
              <button key={p.days} onClick={() => setPeriod(p.days)} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: '0.78rem', fontWeight: 600, border: 'none', cursor: 'pointer',
                background: period === p.days ? 'var(--accent)' : 'transparent',
                color: period === p.days ? 'white' : 'var(--text-muted)',
                transition: 'all 0.15s',
              }}>{p.label}</button>
            ))}
          </div>

          <button onClick={loadLogs} disabled={fetching} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface)',
            color: 'var(--text-secondary)', fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600,
          }}>
            <RefreshCw size={13} style={{ animation: fetching ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>
      </div>

      {lastRefresh && (
        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 20 }}>
          Last updated: {lastRefresh.toLocaleTimeString()}
        </p>
      )}

      {/* Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 28 }}>
        <StatCard icon={Activity} label="Total Scans" value={stats?.total ?? '—'} sub={`${period === 1 ? 'Today' : `Last ${period} days`}`} />
        <StatCard icon={CheckCircle} label="Success Rate" value={stats ? `${stats.successRate}%` : '—'} sub={`${stats?.success ?? 0} succeeded, ${stats?.failed ?? 0} failed`} color={successColor} />
        <StatCard icon={Clock} label="Avg Speed" value={stats?.avgLatencyMs ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : '—'} sub="per scan" color="#60a5fa" />
        <StatCard icon={DollarSign} label="Est. Cost" value={stats ? `$${stats.estimatedCostUsd}` : '—'} sub="~$0.0002 per scan" color="#fbbf24" />
      </div>

      {/* Key Distribution */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <Key size={13} /> Key Distribution
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { label: 'Key 1 (Primary)', count: stats?.key1Count ?? 0, color: '#818cf8' },
              { label: 'Key 2 (Secondary)', count: stats?.key2Count ?? 0, color: '#34d399' },
            ].map(k => {
              const total = (stats?.total ?? 0);
              const pct = total > 0 ? Math.round((k.count / total) * 100) : 0;
              return (
                <div key={k.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
                    <span style={{ color: k.color, fontWeight: 600 }}>{k.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>{k.count} calls ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: 'var(--border)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: k.color, transition: 'width 0.6s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Model Breakdown */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <BarChart2 size={13} /> Model Breakdown
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stats && Object.keys(stats.modelBreakdown).length > 0
              ? Object.entries(stats.modelBreakdown)
                  .sort((a, b) => b[1] - a[1])
                  .map(([model, count]) => (
                    <ModelBar key={model} model={model} count={count} total={stats.total} />
                  ))
              : <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>No data yet.</p>
            }
          </div>
        </div>
      </div>

      {/* Recent Logs */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Zap size={13} /> Recent Scans (last 20)
        </div>
        {fetching
          ? <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Loading...</p>
          : <RecentLogsTable logs={logs} />
        }
      </div>
    </div>
  );
}
