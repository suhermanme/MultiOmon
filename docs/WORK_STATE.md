# Current State

## Current milestone

M04 — Baileys Transport Spike (in progress)

## Completed

- M00 secure Electron, React, strict TypeScript, Vite, testing, and packaging foundation.
- M01 provider-independent domain models and main-process multi-account foundation.
- M02 versioned SQLite persistence and account-scoped repositories.
- Application-owned `MessagingProvider`, `MessagingSession`, `MessagingEvent`,
  `ProviderConnectionState`, `ProviderChat`, and `ProviderMessage` contracts.
- One independently mutable provider session per account with no global transport connection state.
- `ProviderAccountSession` mapping from provider lifecycle events into `AccountManager` state.
- `MockMessagingProvider` pairing-code, connect, disconnect, logout, reconnect, failure, history,
  incoming-message, and outgoing-text simulations.
- `MessagingService` account validation and transactional chat/message projection into SQLite.
- Deterministic account-scoped provider identity mapping with remote-message deduplication.
- Projection notifications published only after successful database transactions.
- Typed chat/message IPC queries and projection-change subscription through the narrow preload API.
- Zustand messaging projection state with stale-request protection during account switching.
- Read-only React conversation list and message timeline backed by SQLite DTOs.
- Startup now seeds accounts only; visible chats/messages originate from mock provider events.
- Offline provider and integration coverage for lifecycle, event flow, persistence, deduplication,
  renderer DTOs, and simultaneous account isolation.

## In progress

- M04 Baileys transport provider abstraction implementation:
  - `WhatsappMessagingProvider` and `WhatsappMessagingSession` created in `src/infrastructure/messaging/whatsapp/`
  - Provider implements the application-owned `MessagingProvider` contract (ADR-012)
  - Session bridges Baileys events to MultiOmon `MessagingEvent` types, mapping connection states to `ProviderConnectionState`
  - Auth state persisted per-account via `useMultiFileAuthState` in `userData/authInfo/<accountId>/`
  - Pairing code requested through Baileys `requestPairingCode(phoneNumber)`; the resulting
    `pairing.code` event is emitted but no IPC channel or pairing UI surfaces it yet
  - Main process wiring added: `WHATSAPP_PROVIDER=1` env var switches from mock to WhatsApp provider
  - Session typing rewritten without `any`; Baileys 6.7.24 API corrections applied
    (`requestPairingCode`, `auth: AuthenticationState`, single `WebMessageInfo` return value, no
    `socket.chats` store, `ev.on`/`ev.removeAllListeners(event)`, Boom `output.statusCode` for 401)
  - Unit and integration tests for the WhatsApp provider fixed; both suites pass

## Not implemented

- Real WhatsApp connection lifecycle: full Baileys event subscription, chat history sync on connect,
  auto-reconnect with exponential backoff, and media message support (M04).
- Real multi-account add/remove/logout UI (M05).
- Production conversation synchronization and conversation-list UX (M06).
- Real message history synchronization and pagination UI (M07).
- Composer or user-facing message sending; mock outgoing sends are exercised below the application
  boundary only (M08).
- Media, reactions, receipts, presence, notifications, and settings.
- Playwright tests; these remain deferred until richer interactive flows exist.

## Known issues

- Existing M02 development databases retain their old seed message alongside the new provider event;
  it is preserved intentionally rather than silently deleting local data.
- Provider pairing codes and lifecycle controls are test-facing; the real diagnostics/pairing surface
  belongs to M04/M05.
- Native installers have not been produced or validated on Windows or Linux.
- Application signing/notarization and custom application artwork are not configured.
- `npm audit` reports eight moderate findings in electron-builder's development-only packaging
  dependency chain; its available downgrade introduces high/critical tar findings, so current
  electron-builder 26.15.3 remains pinned pending an upstream fix.
- The renderer CSP permits WebSocket connections in development for Vite HMR; production output
  should receive a stricter environment-specific CSP during security hardening.
- `WHATSAPP_PROVIDER=1` reaches `AccountManager.connectAll()` during startup, so every seeded account
  opens a live Baileys socket and a real unpaired device-registration handshake before any pairing UI
  exists; a dropped connection re-triggers `connect()` from an uncancellable 5-second timer.
- `logout()` deletes the per-account auth directory but keeps the in-memory `AuthenticationState`, so a
  later `connect()` in the same process can reuse stale credentials.

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
- ADR-012: Messaging transports implement an application-owned, account-scoped provider contract.
- ADR-013: Provider events commit to SQLite before renderer projection notifications are published.

## Verification

- `npm run format` — passed.
- `npm run format:check` — all matched files use Prettier code style.
- `npm run lint` — passed with zero errors and zero warnings.
- `npm run typecheck` — passed for the node and web projects.
- `npm run test:unit` — 6 files and 23 tests passed.
- `npm run test:integration` — 4 files and 15 tests passed.
- `npm test` — 10 files and 38 tests passed; no test performs network access.
- `npm run build` — passed for the main, preload, and renderer bundles. The lazy
  `await import('@whiskeysockets/baileys')` survives bundling as a real dynamic `import()` and
  Baileys stays outside the main bundle.
- `npm run start` — launched the real Electron runtime in mock mode and in `WHATSAPP_PROVIDER=1`
  mode; the WhatsApp mode opened live Baileys sockets for each seeded account (see Known issues).
- `npm run package` and `npm audit --omit=dev --json` — last verified at M03 and not re-run after the
  Baileys dependency was added.

## Recommended next milestone

M04 — Complete Baileys Transport Spike (pairing code flow, live event normalization, media message support)
