# Current State

## Current milestone

M06 — Production conversation synchronization and conversation-list UX (implementation complete in
the working tree, uncommitted on top of `069dca3`; live WhatsApp smoke pending). M05 — Real
multi-account add/remove/logout UI with WhatsApp pairing is complete and committed as `a3d923a` plus
`069dca3`, pushed to `origin/main`.

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
- M06 conversation synchronization: `WhatsappMessagingSession` subscribes to `messaging-history.set`,
  `chats.upsert`, and `chats.update`, and maps them onto the existing `chat.upserted` /
  `message.upserted` events (ADR-020); a `#knownChats` cache of normalized provider chats survives
  reconnects so post-hydration deltas merge against a correct base.
- Baileys unread semantics honored: `chats.update.unreadCount` is merged as a delta against the
  cached base, `null`/`0` are absolute marks-read, protobuf Longs are absolute (ADR-021);
  `MessagingService.#projectMessage` never increments unread on an existing chat and gives new chats
  `1` (incoming) or `0` (outgoing).
- Keyset chat pagination: `ChatRepository.listPage(accountId, limit?, cursor?)` replaces
  `listByAccount`, cursor `{ lastActivityAt, chatId }`, limit clamped to 1..200, ordering
  `COALESCE(last_activity_at, 0) DESC, id DESC`; migration v4 rebuilds `chats_by_account_activity`
  to match (ADR-022).
- Paginated bridge queries: `messaging.listChats`/`messaging.listMessages` accept
  `ChatPageOptionsDto`/`MessagePageOptionsDto`; `src/main/ipc.ts` rejects malformed limits/cursors
  with `TypeError`; `MessagingView` defaults to 30 chats and 50 messages per page and returns message
  pages reversed into chronological order.
- Projection-change batching: `src/main/ipc.ts` coalesces changes per account+chat in a microtask and
  sends one `messaging:changed` array per burst (ADR-023).
- Conversation-list UX: recency-ordered chat pages, unread badges, a search filter over loaded
  chats, a "Load more conversations" cursor button, account-aware empty states keyed by connection
  kind, and a "Load older messages" button that prepends older message pages.
- Reconnect UX: the `connecting` DTO variant carries `attempt`, and the panel header badge shows
  `Connecting · attempt N`; account buttons expose status only through accessible labels.
- Mock provider parity with Baileys: connect seeds chats before messages, `sendText` advances chat
  activity to the sent timestamp, and `simulateIncomingMessage` emits the chat unread delta before
  the message event.
- M06 coverage: `tests/integration/messaging-projection.test.ts` (projection semantics), session
  hydration and unread-delta unit tests, `listPage` boundary tests, and renderer conversation-UX
  tests in `tests/integration/renderer-shell.test.tsx`.

## In progress

M06 code is complete in the working tree and every gate passes, including a mock-mode Electron boot
with no main/renderer errors. Remaining: the live `WHATSAPP_PROVIDER=1` smoke (pair a real phone,
watch the chat list hydrate from history sync) needs a physical phone and has not been run. The
milestone is uncommitted.

## Next milestone scope (M07)

- Media message support: image/video/document/audio content kinds projected into the domain and
  rendered with local download handling.
- History backfill beyond the initial `messaging-history.set` sync (requesting older history from
  the provider and paging it through the same pipeline).
- Message-level polish: date separators and sender labels in long timelines.

## Not implemented

- Media message support and history backfill beyond initial sync (M07).
- Composer or user-facing message sending; mock outgoing sends are exercised below the application
  boundary only (M08).
- Reactions, receipts, presence, notifications, and settings.
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
- ADR-020: Baileys history sync maps onto the existing MessagingEvent vocabulary.
- ADR-021: Unread counts are provider-authoritative deltas.
- ADR-022: Chat pagination is keyset on COALESCE(last_activity_at, 0) DESC with id tiebreak.
- ADR-023: Messaging change notifications are coalesced per account and chat.

## Verification

- `npm run format` — passed.
- `npm run format:check` — all matched files use Prettier code style.
- `npm run lint` — passed with zero errors and zero warnings.
- `npm run typecheck` — passed for the node and web projects.
- `npm run test:unit` — 7 files and 61 tests passed.
- `npm run test:integration` — 7 files and 32 tests passed.
- `npm test` — 14 files and 93 tests passed; no test performs network access.
- `npm run build` — passed for the main, preload, and renderer bundles. The lazy
  `await import('@whiskeysockets/baileys')` survives bundling as a real dynamic `import()` and
  Baileys stays outside the main bundle.
- `npm run start` — re-run in mock mode after installing the Electron binary (user-approved
  exception to ADR-016); the app boots on the local Wayland session with no main or renderer errors.
  The live WhatsApp pairing/hydration smoke is the remaining manual verification step for M06.
- `npm run package` and `npm audit --omit=dev --json` — last verified at M03 and not re-run after the
  Baileys dependency was added.

## Recommended next milestone

M07 — Media message support and history backfill beyond the initial sync.

## Handover

- Standing rule: when a milestone completes, update `docs/DECISIONS.md` (new ADRs) and this file in
  the same pass, then re-run the gates.
- Repository: branch `main` at `069dca3 M05: remove completed handover document` (M05 spans
  `a3d923a` and `069dca3`), pushed and in sync with `origin/main`. The entire M06 implementation
  (21 modified source/test files and the untracked `tests/integration/messaging-projection.test.ts`)
  is uncommitted in the working tree, along with this documentation rollover. `.claude/` stays
  untracked. Commit style is a single-line `MNN: …` subject with no body. Never commit or push
  unless explicitly asked.
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
  `notify`/`lastAlwaysAt`; `DisconnectReason.loggedOut` is a value export, so the `401` literal is
  kept to avoid crossing ADR-012.
- More Baileys 6.7.24 facts (M06): `chats.update.unreadCount` is a per-burst DELTA
  (`process-message.js` builds `(chat.unreadCount || 0) + 1`, `event-buffer.js` merges additively,
  `chat-utils.js` mark-read sends `0`); `messaging-history.set` carries absolute unread counts plus
  `conversationTimestamp`/`lastMessageRecvTimestamp`; `ChatUpdate.id` is optional in the types, so
  the merge guard checks `typeof update.id === 'string'`.
- Electron 44.7.2's binary is installed via `node node_modules/electron/install.js` (an individually
  approved exception to ADR-016); `npm run start` works against the local Wayland session. The two
  remaining blocked install scripts — Baileys `engine-requirements.js` and
  `protobufjs/scripts/postinstall.js` — are no-ops on the Node 26 toolchain used for development.
  `package.json` declares no `engines` field, so the effective runtime is whatever Node launches
  the toolchain.
- `npm run package` and `npm audit --omit=dev --json` have not been re-run since Baileys was added.
