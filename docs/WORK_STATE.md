# Current State

## Current milestone

M00 — Repository Bootstrap and Architecture Skeleton

## Completed

- Initial Electron, React, strict TypeScript, and Vite project structure.
- Secure BrowserWindow defaults and a narrow typed preload bridge skeleton.
- Responsive native-style renderer foundation with system light/dark support.
- ESLint, Prettier, Vitest, and electron-builder configuration.
- Unit security-policy and renderer bridge integration tests.
- Architecture and decision documentation.
- GPL-3.0-only project licensing.

## In progress

- Nothing; M00 is complete.

## Not implemented

- All M01+ functionality, including accounts, domain messaging models, state management, SQLite,
  WhatsApp/Baileys connectivity, media, notifications, and unified inbox.
- Playwright tests; these will be added when critical interactive flows exist.

## Known issues

- Native installers have not been produced or validated on all three operating systems.
- Application signing/notarization is not configured.
- `npm audit` reports eight moderate findings in electron-builder's development-only packaging
  dependency chain; the available downgrade introduces high/critical tar findings, so current
  electron-builder 26.15.3 is retained pending an upstream fix.
- The packaged app currently uses Electron's default icon.
- The renderer CSP permits WebSocket connections in development for Vite HMR; production output
  should receive a stricter environment-specific CSP during security hardening.

## Architecture decisions

- ADR-001: Renderer privileges are isolated behind a sandboxed typed preload bridge.
- ADR-002: Shared contracts contain no infrastructure-specific objects.
- ADR-003: Main/preload and renderer use separate strict compilation contexts.
- ADR-004: Future architecture directories are reserved without speculative implementations.
- ADR-005: The project is licensed under GPL version 3 only.

## Verification

- `npm run format` — passed; all project files formatted.
- `npm run format:check` — passed; all matched files use Prettier style.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed for Node and renderer strict TypeScript projects.
- `npm run test:unit` — passed, 1 file and 1 test.
- `npm run test:integration` — passed, 1 file and 1 test.
- `npm test` — passed, 2 files and 2 tests.
- `npm run build` — passed; main, preload, and renderer production bundles generated.
- `npm run start` — launched the production preview successfully; stopped manually after startup.
- `npm run package` — passed for an unpacked macOS arm64 application at `dist/mac-arm64`.
- `npm audit` — reports 8 moderate, 0 high, and 0 critical findings, all in development packaging
  dependencies; no forced/downgrade fix applied.
- `npm audit --omit=dev` — passed with 0 production dependency vulnerabilities.

## Recommended next milestone

M01 — Domain Model and Multi-Account Foundation
