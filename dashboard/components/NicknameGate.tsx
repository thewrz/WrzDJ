'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { apiClient, ApiError, CollectProfileResponse } from '../lib/api';
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

type GateState = 'loading' | 'error' | 'nickname_input' | 'email_prompt';

export function NicknameGate({ code, onComplete }: Props) {
  const [gateState, setGateState] = useState<GateState>('loading');
  const [savedNickname, setSavedNickname] = useState('');
  const [nicknameInput, setNicknameInput] = useState('');
  const [saving, setSaving] = useState(false);
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
        setGateState('nickname_input');
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        onComplete({ nickname: '', emailVerified: false, submissionCount: 0, submissionCap: 0 });
      } else {
        setGateState('error');
      }
    }
  }, [code, onComplete]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

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
        setGateState('email_prompt');
      }, 1500);
    } catch (err) {
      setInputError(err instanceof ApiError ? err.message : "Couldn't save — please try again");
    } finally {
      setSaving(false);
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

  // email_prompt state
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
