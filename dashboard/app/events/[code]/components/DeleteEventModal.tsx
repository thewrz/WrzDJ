'use client';

import { ModalOverlay } from './ModalOverlay';

interface DeleteEventModalProps {
  eventName: string;
  requestCount: number;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteEventModal({
  eventName,
  requestCount,
  deleting,
  onConfirm,
  onCancel,
}: DeleteEventModalProps) {
  return (
    <ModalOverlay onClose={deleting ? undefined : onCancel}>
      <h2 style={{ marginBottom: '1rem' }}>Delete Event?</h2>
      <p style={{ color: '#9ca3af', marginBottom: '1.5rem' }}>
        This will permanently delete &quot;{eventName}&quot; and all {requestCount} song requests.
        This action cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <button
          className="btn btn-danger"
          onClick={onConfirm}
          disabled={deleting}
          style={{ flex: 1 }}
        >
          {deleting ? 'Deleting...' : 'Delete Event'}
        </button>
        <button
          className="btn"
          style={{ background: '#333' }}
          onClick={onCancel}
          disabled={deleting}
        >
          Cancel
        </button>
      </div>
    </ModalOverlay>
  );
}
