'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient, ApiError } from '../../../../lib/api';

type VerifyState = 'input' | 'code_sent' | 'verified';

interface Props {
  isVerified: boolean;
  onVerified: () => void;
}

export default function EmailVerification({ isVerified, onVerified }: Props) {
  const [state, setState] = useState<VerifyState>(isVerified ? 'verified' : 'input');
  const [email, setEmail] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (state !== 'code_sent' || expiresAt === 0) return;
    const tick = () => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 0) setError('Code expired — request a new one');
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [state, expiresAt]);

  const sendCode = useCallback(async () => {
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.requestVerificationCode(email.trim());
      setState('code_sent');
      setExpiresAt(Date.now() + 15 * 60 * 1000);
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to send code');
    } finally {
      setSending(false);
    }
  }, [email]);

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      if (value.length > 1) {
        const allDigits = value.replace(/\D/g, '').slice(0, 6);
        if (allDigits.length > 1) {
          const next = ['', '', '', '', '', ''];
          for (let i = 0; i < allDigits.length; i++) {
            next[i] = allDigits[i];
          }
          setDigits(next);
          const focusIdx = Math.min(allDigits.length, 5);
          inputRefs.current[focusIdx]?.focus();
          return;
        }
      }
      if (!/^\d?$/.test(value)) return;
      const next = [...digits];
      next[index] = value;
      setDigits(next);
      if (value && index < 5) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
      if (!pasted) return;
      const next = ['', '', '', '', '', ''];
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      setDigits(next);
      const focusIdx = Math.min(pasted.length, 5);
      inputRefs.current[focusIdx]?.focus();
    },
    []
  );

  const handleDigitKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent) => {
      if (e.key === 'Backspace' && !digits[index] && index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    },
    [digits]
  );

  const confirmCode = useCallback(async () => {
    const code = digits.join('');
    if (code.length !== 6) return;
    setConfirming(true);
    setError(null);
    try {
      const result = await apiClient.confirmVerificationCode(email.trim(), code);
      if (result.verified) {
        setState('verified');
        onVerified();
        if (result.merged) {
          window.location.reload();
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed');
      setDigits(['', '', '', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } finally {
      setConfirming(false);
    }
  }, [digits, email, onVerified]);

  useEffect(() => {
    if (digits.every((d) => d !== '') && state === 'code_sent') {
      confirmCode();
    }
  }, [digits, state, confirmCode]);

  if (state === 'verified') {
    return (
      <div className="email-verified-badge">
        <span>&#10003;</span> Email verified
      </div>
    );
  }

  if (state === 'code_sent') {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return (
      <div className="email-verify-code">
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          Code sent to {email}
        </p>
        <div className="verify-digits">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => handleDigitKeyDown(i, e)}
              className="verify-digit-input"
              disabled={confirming}
              autoComplete="one-time-code"
            />
          ))}
          <span className="verify-timer">
            {mins}:{secs.toString().padStart(2, '0')}
          </span>
        </div>
        {error && <p className="collection-fieldset-error">{error}</p>}
        <button
          type="button"
          className="btn-link"
          onClick={sendCode}
          disabled={sending || secondsLeft > 14 * 60}
          style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}
        >
          {sending ? 'Sending...' : "Didn't get it? Resend"}
        </button>
      </div>
    );
  }

  return (
    <div className="email-verify-input">
      <h4 style={{ marginBottom: '0.25rem' }}>Verify your email</h4>
      <ul className="collect-optin-features">
        <li>See your picks across all your devices</li>
        <li>Track your leaderboard position</li>
        <li>Get notified about event changes</li>
      </ul>
      <div className="form-group" style={{ marginBottom: '0.25rem' }}>
        <input
          type="email"
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          onKeyDown={(e) => { if (e.key === 'Enter') sendCode(); }}
        />
      </div>
      {error && <p className="collection-fieldset-error">{error}</p>}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={sendCode}
        disabled={sending || !email.trim()}
      >
        {sending ? 'Sending...' : 'Send Code'}
      </button>
    </div>
  );
}
