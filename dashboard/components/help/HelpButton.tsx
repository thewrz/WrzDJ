'use client';

import { useHelp } from '@/lib/help/HelpContext';

interface HelpButtonProps {
  page: string;
}

export function HelpButton({ page }: HelpButtonProps) {
  const { helpMode, onboardingActive, toggleHelpMode, startOnboarding } = useHelp();

  const handleToggle = () => {
    if (onboardingActive) return;
    toggleHelpMode();
  };

  return (
    <div className="help-btn-container">
      <button
        className={`help-btn${helpMode ? ' help-btn-active' : ''}`}
        onClick={handleToggle}
        aria-label="Toggle help mode"
        aria-pressed={helpMode}
      >
        ?
      </button>
      {helpMode && !onboardingActive && (
        <button
          className="help-tour-btn"
          onClick={() => startOnboarding(page)}
        >
          Start Tour
        </button>
      )}
    </div>
  );
}
