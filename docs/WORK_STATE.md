# Current State

## Current milestone

M01 — Domain Model and Multi-Account Foundation

## Completed

- M00 secure Electron, React, strict TypeScript, Vite, testing, and packaging foundation.
- Provider-independent domain models for Account, AccountConnectionState, Chat, Contact, Message,
  MessageContent, Attachment, Reaction, and Receipt.
- Branded internal identifiers and deterministic account-scoped remote identity keys.
- Explicit validated account connection-state transitions.
- Main-process `AccountManager` with independent in-memory sessions per account.
- Failure-isolated batch connection and independent connect/disconnect state.
- Typed IPC account snapshot, selection, and subscription bridge.
- Zustand renderer projection and polished three-account switcher UI.
- Three mock accounts simultaneously connect; switching active account leaves all sessions connected.
- Unit and renderer integration coverage for M01 acceptance behavior.

## In progress

- Nothing; M01 is complete.

## Not implemented

- SQLite persistence and migrations (M02).
- Formal messaging provider abstraction and mock end-to-end messaging flow (M03).
- WhatsApp/Baileys connectivity, pairing, credentials, chats, messages, media, and notifications.
- Account add/remove controls in the renderer; the visible add button is intentionally disabled.
- Playwright tests; these remain deferred until richer interactive flows exist.

## Known issues

- All three accounts and their connection states are in-memory fixtures and reset on application
  restart.
- Native installers have not been produced or validated on Windows or Linux.
- Application signing/notarization and custom application artwork are not configured.
- `npm audit` reports eight moderate findings in electron-builder's development-only packaging
  dependency chain; its available downgrade introduces high/critical tar findings, so current
  electron-builder 26.15.3 remains pinned pending an upstream fix.
- The renderer CSP permits WebSocket connections in development for Vite HMR; production output
  should receive a stricter environment-specific CSP during security hardening.

## Architecture decisions

- ADR-001: Renderer privileges are isolated behind a sandboxed typed preload bridge.
- ADR-002: Shared contracts contain no infrastructure-specific objects.
- ADR-003: Main/preload and renderer use separate strict compilation contexts.
- ADR-004: Architecture directories were reserved without speculative implementations.
- ADR-005: The project is licensed under GPL version 3 only.
- ADR-006: Messaging identity is explicitly scoped by account.
- ADR-007: The main process owns account sessions; the renderer receives snapshot DTOs.
- ADR-008: Every account has independent mutable session and connection state.

## Verification

- `npm run format` — passed; all project files formatted.
- `npm run format:check` — passed; all matched files use Prettier style.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed for Node and renderer strict TypeScript projects.
- `npm run test:unit` — passed, 4 files and 8 tests.
- `npm run test:integration` — passed, 1 file and 2 tests.
- `npm test` — passed, 5 files and 10 tests.
- `npm run build` — passed; main, preload, and renderer production bundles generated.
- `npm run start` — production Electron preview launched and remained active until manually stopped.
- `npm run package` — passed for an unpacked macOS arm64 application at `dist/mac-arm64`.
- `npm audit --omit=dev` — passed with 0 production dependency vulnerabilities.

## Recommended next milestone

M02 — SQLite Persistence
