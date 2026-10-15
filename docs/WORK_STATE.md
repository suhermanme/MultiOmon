# Current State

## Current milestone

M02 — SQLite Persistence

## Completed

- M00 secure Electron, React, strict TypeScript, Vite, testing, and packaging foundation.
- M01 provider-independent domain models and main-process multi-account foundation.
- SQLite initialization in Electron's platform-specific application data directory.
- Forward-only transactional migration runner with two versioned initial migrations.
- Strict account, contact, chat, and message tables with foreign keys and projection indexes.
- Application-owned typed repository interfaces and SQLite implementations.
- Account, chat, contact, and message persistence with domain-to-row mapping.
- Transaction runner with typed `DatabaseError` wrapping and rollback behavior.
- Account-scoped composite identifiers and remote-ID uniqueness.
- Idempotent message insertion using `(account_id, remote_id)` conflict handling.
- Bounded keyset message pagination using `(sent_at, id)` cursors.
- Transactional mock account/contact/chat/message seeding on a fresh database only.
- Account restoration from SQLite before mock sessions connect on application startup.
- Temporary-file integration coverage for creation, upgrade, reopen, isolation, deduplication,
  rollback, and pagination.

## In progress

- Nothing; M02 is complete.

## Not implemented

- Formal messaging provider abstraction and mock end-to-end messaging flow (M03).
- WhatsApp/Baileys connectivity, pairing, credentials, synchronization, or reconnect behavior.
- Persistence repositories for attachments, reactions, receipts, sync state, or settings; their
  schema is deferred until the milestone that defines their behavior.
- Renderer chat/message projections; persisted M02 fixtures are intentionally not displayed yet.
- Playwright tests; these remain deferred until richer interactive flows exist.

## Known issues

- Account connection state is still represented by in-memory mock sessions and reconnects on every
  launch; only normalized account/chat/contact/message data is durable.
- The fresh-database mock seed returns if any account already exists; production account creation
  and removal behavior will replace this development bootstrap in later milestones.
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
- ADR-009: Synchronous SQLite is isolated behind application repository ports.
- ADR-010: Database schema changes use forward-only transactional migrations.
- ADR-011: Persistence uses account-composite identity, remote deduplication, and keyset pagination.

## Verification

- `npm run format` — passed.
- `npm run format:check` — passed.
- `npm run lint` — passed with zero warnings.
- `npm run typecheck` — passed.
- `npm run test:unit` — 4 files and 8 tests passed.
- `npm run test:integration` — 2 files and 10 tests passed.
- `npm test` — 6 files and 18 tests passed after production packaging.
- `npm run build` — passed for the main, preload, and renderer bundles.
- `npm run start` — launched successfully with the SQLite native binding; a second launch reopened
  the existing database without error.
- `npm run package` — produced the unsigned macOS arm64 application bundle and rebuilt
  `better-sqlite3` for Electron successfully.
- `npm audit --omit=dev --json` — zero production vulnerabilities.

## Recommended next milestone

M03 — Messaging Provider Abstraction
