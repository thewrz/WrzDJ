'use client';

const ACCENT = '#00f0ff';
const ACCENT2 = '#ff2bd6';

interface Props {
  used: number;
  cap: number;
  onOpenSearch: () => void;
}

export default function SubmitBar({ used, cap, onOpenSearch }: Props) {
  const atCap = cap !== 0 && used >= cap;
  const label = cap === 0 ? 'Unlimited picks' : `${used} of ${cap} picks used`;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
      padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px))',
      background: 'linear-gradient(transparent, #06060a 35%)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 600,
        color: atCap ? '#ef4444' : 'rgba(255,255,255,0.45)',
        letterSpacing: 0.5,
      }}>
        {label}
      </span>
      <button
        type="button"
        disabled={atCap}
        onClick={onOpenSearch}
        style={{
          flex: 1, height: 58, borderRadius: 14,
          background: atCap ? 'rgba(255,255,255,0.06)' : `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})`,
          border: 'none', color: atCap ? 'rgba(255,255,255,0.35)' : '#000',
          fontFamily: 'var(--font-grotesk, system-ui)', fontSize: 17, fontWeight: 800, letterSpacing: 0.4,
          cursor: atCap ? 'default' : 'pointer',
          boxShadow: atCap ? 'none' : `0 10px 28px -6px ${ACCENT}80`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 160ms',
        }}
      >
        {!atCap && (
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        )}
        Request a song
      </button>
    </div>
  );
}
