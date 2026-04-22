'use client';

import { useState } from 'react';
import { z } from 'zod';

const emailSchema = z.string().email().max(254);

interface Props {
  hasEmail: boolean;
  onSave: (email: string) => Promise<void>;
}

export default function FeatureOptInPanel({ hasEmail, onSave }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (hasEmail || !expanded) return null;

  const submit = async () => {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError('Invalid email');
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed.data);
      setExpanded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="collect-optin">
      <h3>Get the most out of your picks</h3>
      <ul className="collect-optin-features">
        <li>Notify me when my song plays</li>
        <li>Cross-device &quot;my picks&quot; and leaderboard position</li>
        <li>Persistent profile across events</li>
      </ul>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="collect-email">Email</label>
        <input
          id="collect-email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>
      {error && <p className="collection-fieldset-error">{error}</p>}
      <div className="collect-optin-actions">
        <button
          type="button"
          className="btn btn-sm collect-optin-dismiss"
          onClick={() => setExpanded(false)}
          disabled={saving}
        >
          Keep it anonymous
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={saving}
        >
          Add email
        </button>
      </div>
    </section>
  );
}
