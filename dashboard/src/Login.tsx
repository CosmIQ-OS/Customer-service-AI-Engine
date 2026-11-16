import { useState } from 'react';
import { api, ApiError, type AdminMe } from './api';

export function LoginView({ onLogin }: { onLogin: (admin: AdminMe) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<{ admin: AdminMe }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
      onLogin(result.admin);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? 'Too many failed attempts. Try again later.'
          : 'Invalid username or password.',
      );
    } finally {
      setBusy(false);
      setPassword('');
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-icon">⚡</div>
        <h1 className="login-title">CosmIQ <span style={{ color: 'var(--primary)' }}>OS</span></h1>
        <p className="login-sub">AI Automation Command Center · Sign in</p>

        {error && <div className="banner error" style={{ marginBottom: 18 }}>{error}</div>}

        <form className="form" onSubmit={submit}>
          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Username</label>
            <input
              value={username}
              autoComplete="username"
              placeholder="e.g. admin"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ textAlign: 'left' }}>
            <label className="form-label">Password</label>
            <input
              type="password"
              value={password}
              placeholder="••••••••••••"
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button className="btn" type="submit" disabled={busy} style={{ width: '100%', marginTop: 8 }}>
            {busy ? 'Signing in…' : 'Sign in to Dashboard'}
          </button>
        </form>
      </div>
    </div>
  );
}
