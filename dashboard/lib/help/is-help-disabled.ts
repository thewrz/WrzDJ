/**
 * Checks if the help system is disabled via localStorage flag.
 * Used by screenshot automation to suppress help UI.
 */
export function isHelpDisabled(): boolean {
  try {
    return typeof window !== 'undefined'
      && globalThis.localStorage?.getItem('wrzdj-help-disabled') === '1';
  } catch {
    return false;
  }
}
