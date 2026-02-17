'use client';

import { createContext, useCallback, useContext, useRef, useState, ReactNode } from 'react';
import { api } from '@/lib/api';
import type { HelpSpotConfig, HelpContextValue } from './types';
import { isPageSeen, markPageSeen } from './seen-pages';
import { isHelpDisabled } from './is-help-disabled';

const HelpContext = createContext<HelpContextValue | null>(null);

export function HelpProvider({ children }: { children: ReactNode }) {
  const [helpMode, setHelpMode] = useState(false);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeSpotId, setActiveSpotId] = useState<string | null>(null);
  const spotsRef = useRef<Map<string, HelpSpotConfig>>(new Map());
  const onboardingPageRef = useRef<string | null>(null);

  const [isDisabled] = useState(isHelpDisabled);

  const toggleHelpMode = useCallback(() => {
    if (isDisabled) return;
    setHelpMode((prev) => !prev);
  }, [isDisabled]);

  const registerSpot = useCallback((config: HelpSpotConfig): (() => void) => {
    spotsRef.current.set(config.id, config);
    return () => {
      spotsRef.current.delete(config.id);
    };
  }, []);

  const getSpotsForPage = useCallback((page: string): HelpSpotConfig[] => {
    return Array.from(spotsRef.current.values())
      .filter((s) => s.page === page)
      .sort((a, b) => a.order - b.order);
  }, []);

  const startOnboarding = useCallback((page: string) => {
    if (isDisabled) return;
    const spots = getSpotsForPage(page);
    if (spots.length === 0) return;
    onboardingPageRef.current = page;
    setOnboardingActive(true);
    setCurrentStep(0);
    setActiveSpotId(spots[0].id);
    setHelpMode(true);
  }, [isDisabled, getSpotsForPage]);

  const completeOnboarding = useCallback(() => {
    const page = onboardingPageRef.current;
    setOnboardingActive(false);
    setCurrentStep(0);
    setActiveSpotId(null);
    if (page) {
      markPageSeen(page);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(`wrzdj-help-seen-${page}`, '1');
      }
      api.markHelpPageSeen(page).catch(() => {});
    }
    onboardingPageRef.current = null;
  }, []);

  const nextStep = useCallback(() => {
    const page = onboardingPageRef.current;
    if (!page) return;
    const spots = getSpotsForPage(page);
    const next = currentStep + 1;
    if (next >= spots.length) {
      completeOnboarding();
    } else {
      setCurrentStep(next);
      setActiveSpotId(spots[next].id);
    }
  }, [currentStep, getSpotsForPage, completeOnboarding]);

  const prevStep = useCallback(() => {
    const page = onboardingPageRef.current;
    if (!page || currentStep <= 0) return;
    const spots = getSpotsForPage(page);
    const prev = currentStep - 1;
    setCurrentStep(prev);
    setActiveSpotId(spots[prev].id);
  }, [currentStep, getSpotsForPage]);

  const skipOnboarding = useCallback(() => {
    completeOnboarding();
  }, [completeOnboarding]);

  const hasSeenPage = useCallback((page: string): boolean => {
    if (isDisabled) return true;
    if (isPageSeen(page)) return true;
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(`wrzdj-help-seen-${page}`) === '1';
  }, [isDisabled]);

  return (
    <HelpContext.Provider
      value={{
        helpMode,
        onboardingActive,
        currentStep,
        activeSpotId,
        toggleHelpMode,
        registerSpot,
        getSpotsForPage,
        startOnboarding,
        nextStep,
        prevStep,
        skipOnboarding,
        hasSeenPage,
      }}
    >
      {children}
    </HelpContext.Provider>
  );
}

export function useHelp(): HelpContextValue {
  const context = useContext(HelpContext);
  if (!context) {
    throw new Error('useHelp must be used within a HelpProvider');
  }
  return context;
}
