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
    <div className="app" style={{ maxWidth: 380, margin: '80px auto' }}>
      <h1>Business Support <span className="accent">Engine</span></h1>
      <p className="sub">Admin sign-in</p>
      {error && <div className="card error" style={{ marginBottom: 14 }}>{error}</div>}
      <form className="card form" onSubmit={submit}>
        <label>Username
          <input
            value={username}
            autoComplete="username"
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label>Password
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
