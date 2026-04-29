'use client';

import { useState } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  nickname: string;
  emailVerified: boolean;
  onVerified: () => void;
  picksLabel?: string;
}

export function IdentityBar({ nickname, emailVerified, onVerified, picksLabel }: Props) {
  const [showEmailForm, setShowEmailForm] = useState(false);

  return (
    <div className="identity-bar">
      <span className="identity-bar-name">👤 {nickname}</span>
      {emailVerified ? (
        <span className="identity-bar-verified">✓ Verified</span>
      ) : showEmailForm ? (
        <div className="identity-bar-email-form">
          <EmailVerification
            isVerified={false}
            onVerified={() => {
              onVerified();
              setShowEmailForm(false);
            }}
            onSkip={() => setShowEmailForm(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          className="identity-bar-add-email"
          onClick={() => setShowEmailForm(true)}
        >
          <span className="identity-bar-pulse" aria-hidden="true" />
          + Add email →
        </button>
      )}
      {picksLabel && (
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.45)',
          letterSpacing: '0.04em',
          whiteSpace: 'nowrap',
        }}>
          {picksLabel}
        </span>
      )}
    </div>
  );
}
