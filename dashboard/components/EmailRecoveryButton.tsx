'use client'

interface Props {
  reconcileHint: boolean
  onOpen: () => void
  emailVerified?: boolean
}

export default function EmailRecoveryButton({ reconcileHint, onOpen, emailVerified }: Props) {
  if (emailVerified) return null

  if (reconcileHint) {
    return (
      <div
        style={{
          border: '1px solid #3a3a3a',
          borderRadius: 8,
          padding: '12px 16px',
          background: '#1a1a1a',
          margin: '16px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <div style={{ color: '#ededed', fontWeight: 500 }}>
          Looks like you might be a returning guest.
        </div>
        <button
          type="button"
          onClick={onOpen}
          style={{
            background: '#4a90e2',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            fontWeight: 500,
          }}
        >
          Verify email to recover your account
        </button>
        <div style={{ color: '#888', fontSize: 13 }}>
          Or just continue — your nickname will be saved fresh.
        </div>
      </div>
    )
  }

  return (
    <div style={{ margin: '8px 0', color: '#888', fontSize: 14 }}>
      Already have an account?{' '}
      <button
        type="button"
        onClick={onOpen}
        style={{
          background: 'none',
          border: 'none',
          color: '#4a90e2',
          cursor: 'pointer',
          textDecoration: 'underline',
          padding: 0,
          font: 'inherit',
        }}
      >
        Verify email
      </button>
    </div>
  )
}
