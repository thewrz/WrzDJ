'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiClient, ApiError, CollectProfileResponse, NicknameConflictError } from '../lib/api';
import { useGuestIdentity } from '../lib/use-guest-identity';
import { ModalOverlay } from './ModalOverlay';
import EmailVerification from './EmailVerification';

const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'Nickname must be at least 2 characters')
  .max(30)
  .regex(/^[a-zA-Z0-9 _.-]+$/, 'Letters, numbers, spaces, . _ - only');

export interface GateResult {
  nickname: string;
  emailVerified: boolean;
  submissionCount: number;
  submissionCap: number;
}

interface Props {
  code: string;
  onComplete: (result: GateResult) => void;
}

type GateState =
  | 'loading'
  | 'error'
  | 'track_select'
  | 'nickname_input'
  | 'collision_unclaimed'
  | 'collision_claimed'
  | 'email_login'
  | 'email_code'
  | 'email_prompt';

export function NicknameGate({ code, onComplete }: Props) {
  const identity = useGuestIdentity();
  const [gateState, setGateState] = useState<GateState>('loading');
  const [savedNickname, setSavedNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [codeInput, setCodeInput] = useState('');
  const [collisionNickname, setCollisionNickname] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const [profileCache, setProfileCache] = useState<CollectProfileResponse | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  const loadProfile = useCallback(async () => {
    setGateState('loading');
    try {
      const p = await apiClient.getCollectProfile(code);
      setProfileCache(p);
      if (p.nickname && p.email_verified) {
        onComplete({
          nickname: p.nickname,
          emailVerified: true,
          submissionCount: p.submission_count,
          submissionCap: p.submission_cap,
        });
      } else if (p.nickname) {
        setSavedNickname(p.nickname);
        setGateState('email_prompt');
      } else {
        setGateState('track_select');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onComplete({ nickname: '', emailVerified: false, submissionCount: 0, submissionCap: 0 });
      } else {
        setGateState('error');
      }
    }
  }, [code, onComplete]);

  // Wait for the identify endpoint to set the wrzdj_guest cookie before we
  // call getCollectProfile. Otherwise the backend can't resolve guest_id and
  // (with IP fallback gone) returns the empty default — a returning guest
  // would briefly see the nickname-input modal before settling.
  useEffect(() => {
    if (identity.isLoading) return;
    loadProfile();
  }, [loadProfile, identity.isLoading]);

  const handleSaveNickname = async () => {
    const parsed = nicknameSchema.safeParse(nicknameInput);
    if (!parsed.success) {
      setInputError(parsed.error.issues[0].message);
      return;
    }
    setSaving(true);
    setInputError(null);
    try {
      const p = await apiClient.setCollectProfile(code, { nickname: parsed.data });
      setProfileCache(p);
      setSavedNickname(parsed.data);
      setSavedFlash(true);
      flashTimerRef.current = setTimeout(() => {
        setSavedFlash(false);
        if (emailVerified) {
          onComplete({
            nickname: parsed.data,
            emailVerified: true,
            submissionCount: p.submission_count,
            submissionCap: p.submission_cap,
          });
        } else {
          setGateState('email_prompt');
        }
      }, 1500);
    } catch (err) {
      if (err instanceof NicknameConflictError) {
        setCollisionNickname(parsed.data);
        setGateState(err.claimed ? 'collision_claimed' : 'collision_unclaimed');
      } else {
        setInputError(err instanceof ApiError ? err.message : "Couldn't save — please try again");
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSendCode = async () => {
    setSendingCode(true);
    setInputError(null);
    try {
      await apiClient.requestVerificationCode(emailInput);
      setGateState('email_code');
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : 'Failed to send code. Try again.');
    } finally {
      setSendingCode(false);
    }
  };

  const handleConfirmCode = async () => {
    setVerifyingCode(true);
    setInputError(null);
    try {
      await apiClient.confirmVerificationCode(emailInput, codeInput);
      const p = await apiClient.getCollectProfile(code);
      setProfileCache(p);
      setEmailVerified(true);
      if (p.nickname) {
        onComplete({
          nickname: p.nickname,
          emailVerified: true,
          submissionCount: p.submission_count,
          submissionCap: p.submission_cap,
        });
      } else {
        setGateState('nickname_input');
      }
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : 'Invalid or expired code.');
    } finally {
      setVerifyingCode(false);
    }
  };

  const handleSkip = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: false,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  const handleVerified = () => {
    onComplete({
      nickname: savedNickname,
      emailVerified: true,
      submissionCount: profileCache?.submission_count ?? 0,
      submissionCap: profileCache?.submission_cap ?? 0,
    });
  };

  // ── loading ───────────────────────────────────────────────────────────────

  if (gateState === 'loading') {
    return (
      <ModalOverlay card>
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Connecting…</p>
        </div>
      </ModalOverlay>
    );
  }

  if (gateState === 'error') {
    return (
      <ModalOverlay card>
        <p style={{ marginBottom: '1rem' }}>
          Couldn&apos;t connect to the event. Check your connection and try again.
        </p>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={loadProfile}>
          Retry
        </button>
      </ModalOverlay>
    );
  }

  // ── track_select ──────────────────────────────────────────────────────────

  if (gateState === 'track_select') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Join the event</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem', fontSize: '0.9rem' }}>
          How would you like to identify yourself?
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          onClick={() => setGateState('nickname_input')}
        >
          New name
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => setGateState('email_login')}
        >
          Have email / log in
        </button>
      </ModalOverlay>
    );
  }

  // ── nickname_input ────────────────────────────────────────────────────────

  if (gateState === 'nickname_input') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>What&apos;s your nickname?</h2>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="DancingQueen"
            value={nicknameInput}
            onChange={(e) => {
              setNicknameInput(e.target.value);
              setInputError(null);
            }}
            maxLength={30}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nicknameInput.trim()) handleSaveNickname();
            }}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        {savedFlash && (
          <p style={{ color: '#22c55e', marginBottom: '0.5rem' }}>&#10003; Nickname saved!</p>
        )}
        <button
          className="btn btn-primary"
          style={{ width: '100%' }}
          disabled={!nicknameInput.trim() || saving}
          onClick={handleSaveNickname}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </ModalOverlay>
    );
  }

  // ── collision_unclaimed ───────────────────────────────────────────────────

  if (gateState === 'collision_unclaimed') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>Nickname taken</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          <strong>&ldquo;{collisionNickname}&rdquo;</strong> is already taken.
        </p>
        <p
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          Not claimed yet. If this is yours, go back to the original device you used and claim it
          there with your email.
        </p>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setNicknameInput('');
            setGateState('nickname_input');
          }}
        >
          Try a different nickname
        </button>
      </ModalOverlay>
    );
  }

  // ── collision_claimed ─────────────────────────────────────────────────────

  if (gateState === 'collision_claimed') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.75rem' }}>Nickname taken</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
          <strong>&ldquo;{collisionNickname}&rdquo;</strong> is already taken.
        </p>
        <p
          style={{
            background: 'var(--card-bg)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.75rem',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
            marginBottom: '1rem',
          }}
        >
          This nickname has an email attached — if it&apos;s yours, log in to reclaim it.
        </p>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          onClick={() => setGateState('email_login')}
        >
          Log in with email
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setNicknameInput('');
            setGateState('nickname_input');
          }}
        >
          Try a different nickname
        </button>
      </ModalOverlay>
    );
  }

  // ── email_login ───────────────────────────────────────────────────────────

  if (gateState === 'email_login') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Log in with email</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Enter your email to receive a login code.
        </p>
        <div className="form-group">
          <input
            type="email"
            className="input"
            placeholder="you@example.com"
            value={emailInput}
            onChange={(e) => {
              setEmailInput(e.target.value);
              setInputError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && emailInput.trim()) handleSendCode();
            }}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          disabled={!emailInput.trim() || sendingCode}
          onClick={handleSendCode}
        >
          {sendingCode ? 'Sending…' : 'Send code'}
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => setGateState('track_select')}
        >
          ← Back
        </button>
      </ModalOverlay>
    );
  }

  // ── email_code ────────────────────────────────────────────────────────────

  if (gateState === 'email_code') {
    return (
      <ModalOverlay card>
        <h2 style={{ marginBottom: '0.5rem' }}>Check your email</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
          Enter the 6-digit code sent to {emailInput}.
        </p>
        <div className="form-group">
          <input
            type="text"
            className="input"
            placeholder="6-digit code"
            value={codeInput}
            onChange={(e) => {
              setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 6));
              setInputError(null);
            }}
            maxLength={6}
            autoFocus
          />
        </div>
        {inputError && <p className="collection-fieldset-error">{inputError}</p>}
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.75rem' }}
          disabled={codeInput.length !== 6 || verifyingCode}
          onClick={handleConfirmCode}
        >
          {verifyingCode ? 'Verifying…' : 'Verify'}
        </button>
        <button
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={() => {
            setCodeInput('');
            setGateState('email_login');
          }}
        >
          Resend code
        </button>
      </ModalOverlay>
    );
  }

  // ── email_prompt ──────────────────────────────────────────────────────────

  return (
    <ModalOverlay card>
      <h2 style={{ marginBottom: '0.5rem' }}>Hi, {savedNickname}! 👋</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Add your email to unlock cross-device access and leaderboards.
      </p>
      <EmailVerification isVerified={false} onVerified={handleVerified} onSkip={handleSkip} />
    </ModalOverlay>
  );
}
