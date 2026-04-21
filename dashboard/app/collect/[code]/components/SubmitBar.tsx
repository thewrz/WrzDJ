"use client";

interface Props {
  used: number;
  cap: number; // 0 means unlimited
  onOpenSearch: () => void;
}

export default function SubmitBar({ used, cap, onOpenSearch }: Props) {
  const atCap = cap !== 0 && used >= cap;
  const label =
    cap === 0 ? "Unlimited picks" : `${used} of ${cap} picks used`;

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        background: "#0a0a0a",
        padding: 16,
        borderTop: "1px solid #333",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span>{label}</span>
      <button disabled={atCap} onClick={onOpenSearch}>
        + Add a song
      </button>
    </div>
  );
}
