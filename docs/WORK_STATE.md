# Current State

## Current milestone

M05 — Real multi-account add/remove/logout UI with WhatsApp pairing (implementation complete in the
working tree, uncommitted on top of `aac1f53`; live WhatsApp smoke pending). M04 — Baileys Transport
Spike is complete, committed as `aac1f53`, and pushed to `origin/main`.

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
- M04 Baileys transport spike: `WhatsappMessagingProvider` and `WhatsappMessagingSession` under
  `src/infrastructure/messaging/whatsapp/`, implementing the application-owned `MessagingProvider`
  contract (ADR-012). The lazy `await import('@whiskeysockets/baileys')` in the session is the only
  place allowed to reference the package, and it stays outside the main bundle.
- Per-account `useMultiFileAuthState` storage in `userData/authInfo/<accountId>/`, `creds.update`
  persistence, and teardown through `ev.removeAllListeners(event)` plus `socket.end(undefined)`.
- Typed Baileys normalization with zero `any`: `requestPairingCode(phoneNumber)`,
  `auth: AuthenticationState`, a single `WebMessageInfo` send result, Boom `output.statusCode` 401
  detection, and no `socket.chats` preload.
- `WHATSAPP_PROVIDER=1` switches the main process between the mock and WhatsApp providers.
- WhatsApp unit and integration suites fixed and passing; the offline integration case now asserts
  empty projections and zero change events until a socket exists (ADR-013).
- M05 account lifecycle UI: `AccountProvisioningService`
  (`src/application/accounts/account-provisioning.ts`) owns create validation, account ID minting,
  persistence, and session lifecycle; `src/main/ipc.ts` stays a thin wire adapter (ADR-017).
  `src/main/bootstrap.ts` replaces `src/main/mock-accounts.ts` and wires repositories, provider
  selection, and startup seeding.
- Typed mutating bridge channels `accounts.create/remove/logout/pair/connect` with snapshot fan-out,
  plus a `pairing.subscribe` channel carrying `PairingUpdateDto` (`code`, `qr`, `cleared`).
- `AccountConnectionStateDto` is a discriminated union mirroring the domain connection state
  (ADR-018); `account-view.ts` passes the domain object through unchanged.
- Renderer pairing surface: `src/renderer/src/pairing-store.ts` plus `PairingPanel` in `App.tsx`
  rendering the QR image (rasterized locally with `qrcode`), the pairing code with expiry, and a
  pending state; the panel hides on `cleared` updates emitted when an account leaves the pairing
  states or is removed.
- Pairing is an explicit user action; startup `connectAll()` runs only in mock mode (ADR-019), so
  `WHATSAPP_PROVIDER=1` no longer opens unpaired device-registration handshakes at startup.
- Lifecycle hardening: cancellable exponential-backoff reconnect (base 1s, factor 2, cap 30s);
  `logout()` clears in-memory auth state and removes the per-account auth directory;
  `#cleanupSocket` drops cached `AuthenticationState` so every socket re-reads disk on next init.
- Baileys QR handling corrected: 6.7.x emits the QR on `connection.update` (`update.qr`), not a
  separate `qr` event; the session forwards it as `pairing.qr`.
- Offline coverage for the pairing path end to end: `tests/integration/account-pairing-flow.test.ts`
  (application fan-out) and `tests/integration/pairing-ui.test.tsx` (real `App` against a fake bridge).

## In progress

M05 code is complete in the working tree and every gate passes. Remaining: the live
`WHATSAPP_PROVIDER=1` smoke (add a real account, scan the QR or enter the pairing code, watch the
panel clear on connect) needs a physical phone and has not been run. The milestone is uncommitted.

## Next milestone scope (M06)

- Production conversation synchronization: hydrate the chat list on connect from Baileys history
  sync events instead of chats appearing only from live messages.
- Conversation-list UX: recency ordering, unread indicators, search, and account-aware empty states.
- Paginated chat/message queries across the bridge so long histories do not cross IPC in one payload.
- Reconnect UX: surface `connecting` attempt/backoff state in the account badge.

## Not implemented

- Chat history sync on connect and media message support (M07); the Baileys subscription covers
  `connection.update`, `chats.upsert`, `messages.upsert`, and `creds.update` only.
- Production conversation synchronization and conversation-list UX (M06).
- Real message history synchronization and pagination UI (M07).
- Composer or user-facing message sending; mock outgoing sends are exercised below the application
  boundary only (M08).
- Media, reactions, receipts, presence, notifications, and settings.
- Playwright tests; these remain deferred until richer interactive flows exist.

## Known issues

- Existing M02 development databases retain their old seed message alongside the new provider event;
  it is preserved intentionally rather than silently deleting local data.
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
- ADR-012: Messaging transports implement an application-owned, account-scoped provider contract.
- ADR-013: Provider events commit to SQLite before renderer projection notifications are published.
- ADR-014: Baileys is reached lazily and only inside the WhatsApp adapter.
- ADR-015: the live WhatsApp transport is opt-in through `WHATSAPP_PROVIDER=1`.
- ADR-016: dependency install scripts stay blocked unless individually reviewed.
- ADR-017: Account provisioning is an application service; IPC handlers stay thin wire adapters.
- ADR-018: Connection state crosses the bridge as a discriminated DTO mirroring the domain union.
- ADR-019: Pairing is an explicit user action; startup auto-connect runs only in mock mode.

## Verification

- `npm run format` — passed.
- `npm run format:check` — all matched files use Prettier code style.
- `npm run lint` — passed with zero errors and zero warnings.
- `npm run typecheck` — passed for the node and web projects.
- `npm run test:unit` — 7 files and 52 tests passed.
- `npm run test:integration` — 6 files and 22 tests passed.
- `npm test` — 13 files and 74 tests passed; no test performs network access.
- `npm run build` — passed for the main, preload, and renderer bundles. The lazy
  `await import('@whiskeysockets/baileys')` survives bundling as a real dynamic `import()` and
  Baileys stays outside the main bundle.
- `npm run start` — last launched at M04 in mock and `WHATSAPP_PROVIDER=1` modes; the live WhatsApp
  pairing smoke is the remaining manual verification step for M05.
- `npm run package` and `npm audit --omit=dev --json` — last verified at M03 and not re-run after the
  Baileys dependency was added.

## Recommended next milestone

M06 — Production conversation synchronization and conversation-list UX: chat hydration on connect,
recency/unread ordering, and paginated bridge queries.

## Handover

- Standing rule: when a milestone completes, update `docs/DECISIONS.md` (new ADRs) and this file in
  the same pass, then re-run the gates.
- Repository: branch `main` at `aac1f53 M04: add Baileys messaging transport`, pushed and in sync
  with `origin/main`. The entire M05 implementation (29 modified files, `src/main/mock-accounts.ts`
  deleted, and `src/application/accounts/account-provisioning.ts`, `src/main/bootstrap.ts`,
  `src/renderer/src/pairing-store.ts`, plus four new test files untracked) is uncommitted in the
  working tree, along with this documentation rollover. Commit style is a single-line `MNN: …`
  subject with no body. Never commit or push unless explicitly asked.
- Gate order: `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm test` →
  `npm run build`. `npm run package` and `npm run dist` only on request after a green build.
- Constraints the WhatsApp transport must keep honoring: top-level `import type` only, no dynamic
  import outside the single ADR-012 site, `consistent-type-imports`, `no-explicit-any`, and
  `eslint . --max-warnings=0`. `no-unnecessary-condition` is not enabled, so defensive `?.` is fine.
- Baileys 6.7.24 facts that cost debugging time: `WASocket = ReturnType<typeof makeWASocket>`;
  QR codes arrive on `connection.update` as `update.qr` (re-emitted every ~20 seconds, cleared with
  `{ isNewLogin: true, qr: undefined }`); Baileys 6.7.x has no `qr` event.
  `requestPairingCode(phoneNumber, customPairingCode?)`; `sendMessage` resolves to a single
  `proto.WebMessageInfo | undefined`; `auth` must be `{ creds, keys }`; there is no chat store on the
  socket; only `socket.ev.on` exists and `removeAllListeners` requires an event name; disconnect
  errors are `@hapi/boom` Booms carrying `output.statusCode`; `lastDisconnect.date`, not `timestamp`;
  `socket.end(undefined)` requires the argument; `Chat` has `conversationTimestamp` but no
  `notify`/`lastAlwaysAt`. `DisconnectReason.loggedOut` is a value export, so the `401` literal is
  kept to avoid crossing ADR-012.
- Two install scripts stay blocked on purpose — Baileys `engine-requirements.js` and
  `protobufjs/scripts/postinstall.js` — because both are no-ops on the Node 26 toolchain used for
  development. `package.json` declares no `engines` field, so the effective runtime is whatever Node
  launches the toolchain.
- `npm run package` and `npm audit --omit=dev --json` have not been re-run since Baileys was added.
