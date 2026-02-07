import { useState, type FormEvent } from 'react';

interface LoginFormProps {
  onLogin: (apiUrl: string, username: string, password: string) => Promise<void>;
  error: string | null;
  loading: boolean;
}

export function LoginForm({ onLogin, error, loading }: LoginFormProps) {
  const [apiUrl, setApiUrl] = useState('https://api.wrzdj.com');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await onLogin(apiUrl, username, password);
    } catch {
      // Error is handled by parent via error prop
    }
  };

  return (
    <div className="login-container">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>WrzDJ Bridge</h1>
        <p>Sign in to connect your DJ equipment</p>

        {error && <div className="error-message">{error}</div>}

        <div className="form-group">
          <label htmlFor="apiUrl">Server URL</label>
          <input
            id="apiUrl"
            className="input"
            type="url"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="https://api.wrzdj.com"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="input"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-full"
          disabled={loading || !username || !password}
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
