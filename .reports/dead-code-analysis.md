# Dead Code Analysis Report

**Date:** 2026-02-06
**Branch:** refactor-before-sprint
**Analyzer:** Manual + ruff (Python), tsc (TypeScript), vitest

---

## Summary

| Service | Files Analyzed | Dead Code Found | Items Removed |
|---------|---------------|-----------------|---------------|
| Backend (Python) | 51 | 2 | 2 |
| Frontend (TypeScript) | 12 | 1 | 1 |
| Bridge (TypeScript) | 7 | 2 | 2 |
| **Total** | **70** | **5** | **5** |

**Codebase health:** Excellent. Less than 0.5% dead code across all services.

---

## Removed Items

### 1. SAFE: `get_event_by_code()` - Backend

- **File:** `server/app/services/event.py` (was line 58-69)
- **Type:** Unused function
- **Reason:** Superseded by `get_event_by_code_with_status()` which provides richer status information. Zero callers in entire codebase.
- **Risk:** None

### 2. SAFE: `TidalAuthUrl` schema - Backend

- **File:** `server/app/schemas/tidal.py` (was line 6-10)
- **Type:** Unused Pydantic model
- **Reason:** Tidal integration uses device code flow, not OAuth redirect. This schema for OAuth URLs was never used.
- **Risk:** None

### 3. SAFE: `TidalAuthUrl` interface - Frontend

- **File:** `dashboard/lib/api.ts` (was line 134-137)
- **Type:** Unused TypeScript interface
- **Reason:** Never imported. The `startTidalAuth()` method returns `{ verification_url, user_code, message }` which doesn't match this interface.
- **Risk:** None

### 4. SAFE: Duplicate `TrackInfo` interface - Bridge

- **File:** `bridge/src/types.ts` (was line 6-11)
- **Type:** Duplicate interface
- **Reason:** Identical to `TrackInfo` in `bridge/src/deck-state.ts:9` which is the canonical version used by all imports. The `types.ts` version was never imported.
- **Risk:** None

### 5. SAFE: `makeTrackKey()` export keyword - Bridge

- **File:** `bridge/src/bridge.ts:19`
- **Type:** Unnecessary export
- **Reason:** Only used internally within the same file. Removed `export` to reduce public API surface.
- **Risk:** None

---

## Not Removed (Investigated but kept)

### Frontend interfaces used internally

- `PublicRequestInfo` (api.ts:60) - Referenced by `KioskDisplay` interface in same file
- `DisplaySettingsResponse` (api.ts:76) - Used as return type by API methods in same file

### Bridge test-only public methods

- `shouldReportTrack()` (deck-state-manager.ts:501) - Public for testing
- `getCurrentNowPlayingDeckId()` (deck-state-manager.ts:538) - Public for testing

### Unused devDependencies (frontend)

- `@eslint/eslintrc` - May be needed by ESLint flat config internals
- `eslint-config-next` - May be pulled in transitively by Next.js

These were left alone as removing npm devDependencies carries risk of breaking the build pipeline.

---

## Test Verification

All tests passed after removals:

| Service | Tests | Coverage |
|---------|-------|----------|
| Backend | 206 passed | 77% (threshold: 70%) |
| Bridge | 47 passed | N/A |
| Frontend | 23 passed | N/A |

---

## Automated Checks Run

- `ruff check --select F401` (unused imports): 0 findings
- `ruff check --select F841` (unused variables): 0 findings
- `ruff check --select F811` (redefined names): 0 findings
- `ruff format`: All files formatted
- `tsc --noEmit` (dashboard): 0 errors
- `tsc --noEmit` (bridge): 0 errors
