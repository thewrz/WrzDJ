/**
 * Module-level store for help pages the user has already seen.
 * Shared between AuthProvider (writes after /me) and HelpContext (reads).
 */
const seenPages = new Set<string>();

export function initSeenPages(pages: string[]) {
  seenPages.clear();
  pages.forEach((p) => seenPages.add(p));
}

export function isPageSeen(page: string): boolean {
  return seenPages.has(page);
}

export function markPageSeen(page: string) {
  seenPages.add(page);
}
