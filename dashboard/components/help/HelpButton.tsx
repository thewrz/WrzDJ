'use client';

import { useHelp } from '@/lib/help/HelpContext';
import { isHelpDisabled } from '@/lib/help/is-help-disabled';

interface HelpButtonProps {
  page: string;
  inline?: boolean;
}

export function HelpButton({ page, inline }: HelpButtonProps) {
  const { helpMode, onboardingActive, toggleHelpMode, startOnboarding } = useHelp();

  const isDisabled = isHelpDisabled();

  const handleToggle = () => {
    if (onboardingActive) return;
    toggleHelpMode();
  };

  if (isDisabled) return null;

  return (
    <div className={inline ? 'help-btn-container-inline' : 'help-btn-container'}>
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
