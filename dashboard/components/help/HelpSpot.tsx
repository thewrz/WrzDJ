'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';
import { useHelp } from '@/lib/help/HelpContext';

interface HelpSpotProps {
  spotId: string;
  page: string;
  order: number;
  title: string;
  description: string;
  children: ReactNode;
}

export function HelpSpot({ spotId, page, order, title, description, children }: HelpSpotProps) {
  const { helpMode, onboardingActive, activeSpotId, registerSpot } = useHelp();
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const deregister = registerSpot({ id: spotId, page, order, title, description, ref });
    return deregister;
  }, [spotId, page, order, title, description, registerSpot]);

  const isActive = activeSpotId === spotId;
  const showTooltip = helpMode && (isActive || (hovered && !onboardingActive));
  const showHighlight = helpMode;

  return (
    <div
      ref={ref}
      data-testid={`help-spot-${spotId}`}
      data-help-spot={spotId}
      className={showHighlight ? 'help-spot-highlight' : undefined}
      style={showHighlight ? { position: 'relative' } : { display: 'contents' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {showTooltip && (
        <div className="help-tooltip" role="tooltip" aria-live="polite">
          <div className="help-tooltip-title">{title}</div>
          <div className="help-tooltip-desc">{description}</div>
        </div>
      )}
    </div>
  );
}
