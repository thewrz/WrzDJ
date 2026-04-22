'use client';

import { useState } from 'react';
import { z } from 'zod';

const emailSchema = z.string().email().max(254);
const nicknameSchema = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[a-zA-Z0-9 _.-]+$/, 'Letters, numbers, spaces, . _ - only');

interface Props {
  hasEmail: boolean;
  initialNickname: string | null;
  onSave: (data: { nickname?: string; email?: string }) => Promise<void>;
}

export default function FeatureOptInPanel({ hasEmail, initialNickname, onSave }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [nickname, setNickname] = useState(initialNickname ?? '');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Hide once the guest either has an email OR has chosen a nickname and dismissed.
  if ((hasEmail || !expanded) && initialNickname !== null) return null;
  if (hasEmail && !expanded) return null;

  const submit = async () => {
    const payload: { nickname?: string; email?: string } = {};

    const nickTrimmed = nickname.trim();
    if (nickTrimmed) {
      const nickResult = nicknameSchema.safeParse(nickTrimmed);
      if (!nickResult.success) {
        setError(nickResult.error.issues[0].message);
        return;
      }
      payload.nickname = nickResult.data;
    }

    const emailTrimmed = email.trim();
    if (emailTrimmed) {
      const emailResult = emailSchema.safeParse(emailTrimmed);
      if (!emailResult.success) {
        setError('Invalid email');
        return;
      }
      payload.email = emailResult.data;
    }

    if (Object.keys(payload).length === 0) {
      setError('Enter a nickname or email (or both)');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave(payload);
      setExpanded(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="collect-optin">
      <h3>Make it yours</h3>
      <p
        style={{
          fontSize: '0.875rem',
          color: 'var(--text-secondary)',
          marginBottom: '0.75rem',
        }}
      >
        Pick a nickname so the DJ knows who suggested what. Add an email for extra perks.
      </p>
      <ul className="collect-optin-features">
        <li>Nickname appears next to your picks</li>
        <li>Email (optional): notify me when my song plays</li>
        <li>Email: cross-device &quot;my picks&quot; and leaderboard position</li>
      </ul>

      <div className="form-group">
        <label htmlFor="collect-nickname">Nickname</label>
        <input
          id="collect-nickname"
          type="text"
          className="input"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="DancingQueen"
          maxLength={30}
        />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label htmlFor="collect-email">Email (optional)</label>
        <input
          id="collect-email"
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={hasEmail}
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
          {initialNickname ? 'Close' : 'Skip'}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  );
}
