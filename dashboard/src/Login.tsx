import { useState } from 'react';
import { api, ApiError, type AdminMe } from './api';

interface LoginViewProps {
  onLogin: (admin: AdminMe) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export function LoginView({ onLogin, theme = 'light', onToggleTheme }: LoginViewProps) {
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
        <div className="login-head">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div className="kicker">Operator Sign-In</div>
            {onToggleTheme && (
              <button
                type="button"
                className="theme-btn"
                onClick={onToggleTheme}
              >
                {theme === 'light' ? 'PAPER' : 'OBSIDIAN'}
              </button>
            )}
          </div>
          <h1 className="login-title">COSMIQ OS</h1>
          <p className="login-sub">Support &amp; Deterministic Quotation Workbench</p>
        </div>

        {error && <div className="banner error">{error}</div>}

        <form className="form" onSubmit={submit}>
          <label>
            Operator Username
            <input
              value={username}
              autoComplete="username"
              placeholder="admin"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              placeholder="••••••••••••"
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', marginTop: 6 }}>
            {busy ? 'AUTHENTICATING…' : 'SIGN IN TO WORKBENCH'}
          </button>
        </form>
      </div>
    </div>
  );
}
