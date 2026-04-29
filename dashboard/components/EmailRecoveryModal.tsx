'use client';

import { useEffect } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  open: boolean;
  onClose: () => void;
  onRecovered: () => void;
}

export default function EmailRecoveryModal({ open, onClose, onRecovered }: Props) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleVerified = () => {
    onRecovered();
    setTimeout(onClose, 1500);
  };

  return (
    <div
      data-testid="modal-backdrop"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-labelledby="recovery-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1a1a1a',
          border: '1px solid #3a3a3a',
          borderRadius: 12,
          padding: 24,
          maxWidth: 420,
          width: '100%',
          color: '#ededed',
        }}
      >
        <h2 id="recovery-title" style={{ margin: '0 0 16px', fontSize: 18 }}>
          Recover your account
        </h2>
        <EmailVerification isVerified={false} onVerified={handleVerified} />
      </div>
    </div>
  );
}
