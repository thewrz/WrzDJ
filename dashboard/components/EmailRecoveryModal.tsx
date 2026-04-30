'use client';

import { useEffect, useRef } from 'react';
import EmailVerification from './EmailVerification';

interface Props {
  open: boolean;
  onClose: () => void;
  onRecovered: () => void;
}

export default function EmailRecoveryModal({ open, onClose, onRecovered }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ESC closes; Tab cycles focus within the dialog.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Cleanup any pending close-after-recovery timeout on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  if (!open) return null;

  const handleVerified = () => {
    onRecovered();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      onClose();
    }, 1500);
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
        ref={dialogRef}
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
