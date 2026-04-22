'use client';

interface Props {
  used: number;
  cap: number; // 0 means unlimited
  onOpenSearch: () => void;
}

export default function SubmitBar({ used, cap, onOpenSearch }: Props) {
  const atCap = cap !== 0 && used >= cap;
  const label = cap === 0 ? 'Unlimited picks' : `${used} of ${cap} picks used`;

  return (
    <div className="collect-submit-bar">
      <span className={`collect-cap-counter${atCap ? ' at-cap' : ''}`}>{label}</span>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={atCap}
        onClick={onOpenSearch}
      >
        + Add a song
      </button>
    </div>
  );
}
