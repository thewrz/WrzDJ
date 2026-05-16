'use client';

import { useState } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  nickname: string;
  emailVerified: boolean;
  onVerified: () => void;
  picksLabel?: string;
  forceDark?: boolean;
}

export function IdentityBar({ nickname, emailVerified, onVerified, picksLabel, forceDark }: Props) {
  const [showEmailForm, setShowEmailForm] = useState(false);

  const darkVars = forceDark ? ({
    '--card': '#1a1a1a',
    '--border-subtle': 'rgba(255,255,255,0.08)',
    '--text-secondary': '#9ca3af',
  } as React.CSSProperties) : undefined;

  return (
    <div className="identity-bar" style={darkVars}>
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
