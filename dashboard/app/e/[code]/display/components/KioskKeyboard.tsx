'use client';

import { useRef, useEffect, useCallback } from 'react';
import Keyboard from 'simple-keyboard';
import 'simple-keyboard/build/css/index.css';
import './KioskKeyboard.css';

interface KioskKeyboardProps {
  onChange: (value: string) => void;
  onDone: () => void;
  inputValue: string;
  doneLabel?: string;
  resetTimer: () => void;
}

const LAYOUTS = {
  default: [
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m {bksp}',
    '{numbers} {space} {done}',
  ],
  shift: [
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M {bksp}',
    '{numbers} {space} {done}',
  ],
  numbers: [
    '1 2 3 4 5 6 7 8 9 0',
    '- / : ; ( ) $ & @ "',
    "{abc} . , ? ! ' {bksp}",
    '{abc} {space} {done}',
  ],
};

const DISPLAY_BASE = {
  '{bksp}': '\u232b',
  '{space}': ' ',
  '{shift}': '\u21e7',
  '{numbers}': '123',
  '{abc}': 'ABC',
};

export function KioskKeyboard({
  onChange,
  onDone,
  inputValue,
  doneLabel = 'Done',
  resetTimer,
}: KioskKeyboardProps) {
  const keyboardRef = useRef<Keyboard | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep callbacks fresh without re-mounting
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const resetTimerRef = useRef(resetTimer);
  resetTimerRef.current = resetTimer;

  // Mount keyboard once
  useEffect(() => {
    if (!containerRef.current) return;

    const kb = new Keyboard(containerRef.current, {
      layout: LAYOUTS,
      layoutName: 'default',
      theme: 'hg-theme-default',
      display: { ...DISPLAY_BASE, '{done}': doneLabel },
      onChange: (input: string) => {
        resetTimerRef.current();
        onChangeRef.current(input);
      },
      onKeyPress: (button: string) => {
        resetTimerRef.current();

        if (button === '{done}') {
          onDoneRef.current();
          return;
        }

        if (button === '{shift}') {
          const current = kb.options.layoutName;
          kb.setOptions({
            layoutName: current === 'shift' ? 'default' : 'shift',
          });
          return;
        }

        if (button === '{numbers}') {
          kb.setOptions({ layoutName: 'numbers' });
          return;
        }

        if (button === '{abc}') {
          kb.setOptions({ layoutName: 'default' });
          return;
        }

        // Auto-return to lowercase after typing a shifted character
        if (kb.options.layoutName === 'shift' && button !== '{bksp}') {
          kb.setOptions({ layoutName: 'default' });
        }
      },
    });

    keyboardRef.current = kb;

    return () => {
      kb.destroy();
      keyboardRef.current = null;
    };
  }, []);

  // Update Done button label without remounting
  useEffect(() => {
    if (keyboardRef.current) {
      keyboardRef.current.setOptions({
        display: { ...DISPLAY_BASE, '{done}': doneLabel },
      });
    }
  }, [doneLabel]);

  // Sync external input value to keyboard
  const syncInput = useCallback((value: string) => {
    if (keyboardRef.current) {
      keyboardRef.current.setInput(value);
    }
  }, []);

  useEffect(() => {
    syncInput(inputValue);
  }, [inputValue, syncInput]);

  return (
    <div className="kiosk-keyboard-wrapper">
      <div ref={containerRef} className="kiosk-keyboard" />
    </div>
  );
}
