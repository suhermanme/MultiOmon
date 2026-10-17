# Current State

## Current milestone

M07 — Media messages, provider history backfill, timeline polish, and responsive account UI are
committed at `98c1728` on `main`. Live WhatsApp verification still requires a physical phone;
pairing has been exercised through code issuance but end-to-end linking and media verification are
still pending. M08 text sending, replies, active-conversation mark-read, and outgoing delivery/read
receipt tracking are implemented in the working tree (details below); media sending remains.

## Completed

- M00–M02: secure Electron/React foundation, provider-independent domain, and versioned SQLite
  persistence.
- M03–M04: account-scoped provider abstraction, deterministic mock transport, durable messaging
  projection, and opt-in Baileys transport behind `WHATSAPP_PROVIDER=1`.
- M05: account create/remove/logout/connect/pair lifecycle, typed IPC fan-out, QR/pairing-code UI,
  explicit live-provider connection, credential cleanup, and reconnect backoff.
- M06: Baileys initial history/chat synchronization, provider-authoritative unread deltas, keyset
  conversation and message pagination, batched projection notifications, search, pagination UX,
  and reconnect status.
- M07 media projection: Baileys image/video/audio/document/sticker messages normalize into the
  provider-neutral media contract. Migration v5 adds account-scoped attachment metadata and opaque
  provider references outside message rows (ADR-024).
- M07 media retrieval: `MediaFileStore` caches bytes below `userData/media/<accountId>/` only after
  a user requests them. The bridge returns a MIME-qualified data URL without exposing local paths;
  the UI renders image/sticker previews, video/audio controls, and document downloads (ADR-026).
- M07 history backfill: `MessagingService.requestHistory` anchors requests at the oldest durable
  message; WhatsApp maps this to `fetchMessageHistory`, while mock sessions replay deterministic
  older pages through the same projection pipeline (ADR-025).
- M07 timeline polish: date separators, sender labels, local times, media metadata, and an explicit
  “Fetch earlier history” action after local pages are exhausted.
- UI repair: the account rail is a real responsive sidebar with readable names, a compact account
  launcher, a focused modal creation flow, styled lifecycle controls, and bounded pairing content.
  This fixes the form/button overflow and clipping visible in the M06 shell.
- Live pairing hardening: Pair always starts the Baileys QR protocol; an optional account phone
  number is metadata and no longer switches protocols implicitly. Pair also discards only an
  unregistered, half-created identity left by an older interrupted pairing-code request, preventing
  the subsequent login-shaped 408 failure.
- WhatsApp identity/UI repair: LID conversation keys retain their `@lid` transport identity while
  contact names or mapped phone identities are used for display. Migration v6 removes only the
  transport-control placeholder messages produced by the earlier adapter and repairs the affected
  control-only LID chat key. Protocol packets are no longer projected as messages.
- The application shell is constrained to the viewport so conversation and account lists scroll
  inside their own panes instead of being clipped by the window-level overflow guard.

## In progress / manual verification

- Pair a real phone with `WHATSAPP_PROVIDER=1`, verify initial chat hydration, request an older
  history page, open at least one image/audio/document attachment, send a text reply, and watch a
  delivered/read tick appear on the outgoing message.
- Native installers have not been produced or validated on Windows or Linux.

## Current milestone (M08)

- Implemented: a connected-account composer sends user-facing text through the provider port,
  application service, typed IPC, and preload bridge. The application validates the target chat,
  projects the returned message idempotently, and refreshes the local timeline. Failed sends show
  feedback and preserve the draft. Enter sends; Shift+Enter inserts a newline.
- Implemented since the previous handover: reply selection and reply previews now pass the local
  target message ID through IPC; the application resolves it within the same account/chat before
  passing the provider remote key. A pending “Sending…” bubble appears while the provider call is in
  flight. Opening an unread conversation while connected calls the scoped mark-read bridge; the
  WhatsApp session uses Baileys `readMessages`, then the local chat unread count is cleared.
- Implemented since the previous handover: outgoing receipt tracking. Baileys
  `message-receipt.update` and deterministic mock acknowledgements normalize into the
  `message.receipted` provider event; migration v7 adds the account-scoped `receipts` table keyed
  by message and recipient with monotonic status promotion; `MessagingService.#projectReceipt`
  drops receipts that reference unknown or incoming messages; `MessagingView` aggregates
  per-recipient receipts into `MessageDto.receiptStatus` (weakest status wins) and the timeline
  renders sent/delivered/read ticks (ADR-027).
- Implemented since the previous handover: partial-unread mark-read semantics. When the mark-read
  scan stops at its 40,000-message page guard, the local unread count is decremented by the ids
  actually marked instead of staying frozen; the count is zeroed only when local history is
  exhausted or fully covered (ADR-028).
- Manual live-provider verification remains needed for sending/replying, mark-read behavior, and
  receipt ticks on a linked phone.
- Useful existing foundations: provider `SendTextRequest` already accepts
  `replyToRemoteMessageId`; the WhatsApp adapter already maps that to Baileys `quoted`; domain
  messages and SQLite already store `replyToMessageId`, and the DTO/view expose this linkage.
  `Receipt`/`ReceiptStatus` domain types now have a full repository/schema/event-to-projection
  path. Baileys `socket.readMessages(keys)` is wired for active-conversation read marking, and
  mark-read pages local messages in chunks of 200 (up to 40,000) because the repository
  intentionally caps page sizes at 200.
- Media sending can follow after the text composer path is stable.

## Not implemented

- Media sending.
- Reactions, presence, desktop notifications, settings, and contact/profile enrichment.
- Playwright coverage and native installer CI.

## Known issues

- Existing M02 development databases retain their original seed message intentionally.
- Live Baileys media/history behavior is covered offline with protocol-shaped fakes but still needs
  the physical-phone smoke above.
- Media data URLs copy downloaded bytes across IPC once when opened; a streaming custom protocol is
  the likely follow-up for very large video/document files.
- `npm audit` previously reported moderate findings in electron-builder's development-only chain;
  the available downgrade introduced worse tar findings, so electron-builder remains pinned.
- Development CSP permits WebSockets for Vite HMR; production hardening should emit a stricter CSP.

## Architecture decisions

- ADR-001–ADR-016: secure process boundaries, scoped identity/persistence, provider abstraction,
  lazy live transport, opt-in WhatsApp, and reviewed install scripts.
- ADR-017–ADR-019: application-owned provisioning, discriminated connection DTOs, and explicit
  pairing/connection.
- ADR-020–ADR-023: normalized history synchronization, provider-authoritative unread semantics,
  keyset chat pagination, and batched projection hints.
- ADR-024: media metadata is durable; media bytes are cached on demand.
- ADR-025: older history is requested from the oldest durable message.
- ADR-026: media rendering remains capability-scoped through IPC.
- ADR-027: receipts are projected only for outgoing messages and aggregated to the weakest status.
- ADR-028: mark-read scans decrement unread when the page guard truncates them.

## Verification

- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
  `git diff --check` passed after the receipt pipeline, mark-read page-guard semantics, and
  renderer tick changes.
- `npm test` — 14 files and 114 tests passed, including the new receipt adapter/projection/database
  coverage, the mock acknowledgement flow, the renderer tick rendering test, and the three
  mark-read semantics tests (full coverage, unsubstantiated provider counts, and the guarded
  decrement).
- `npm run start` — mock-mode Electron shell launched on the local Wayland display without main or
  renderer errors; the process was stopped after the smoke check.
- `npm run package` and `npm run dist` — not run; only run on explicit request.

## Handover

- Branch `main` is at `98c1728 M07: add media, history, and WhatsApp pairing fixes`. M08 text
  sending, replies, mark-read, and receipt tracking are in progress and uncommitted across
  `docs/WORK_STATE.md`, `docs/DECISIONS.md`, `docs/ui_problem_analysis.md`, application
  messaging/provider ports, database migrations/repositories (including the new v7 `receipts`
  table), mock and WhatsApp messaging sessions, IPC, preload, renderer, shared desktop contracts,
  and existing API/session test fixtures. `.claude/` remains unrelated and untracked; do not stage
  or alter it.
- Never commit or push unless explicitly requested. Commit subjects use `MNN: …` with no body.
- Gate order: `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm test` →
  `npm run build`.
- Next session: implement media sending through the composer (a provider-port send path for media
  payloads, Baileys `sendMessage` media mapping, and renderer file selection), then run the normal
  verification gate. Live-provider smoke for sending/replying, mark-read, and receipt ticks still
  requires a physical phone; do not mark M08 complete until media sending and the live smoke are
  done.
- Keep Baileys runtime access confined to the one lazy `await import('@whiskeysockets/baileys')` in
  `WhatsappMessagingSession`; general application, domain, shared, and renderer code stay transport
  neutral.
- Baileys 6.7.x facts: pairing QR is on `connection.update`; `chats.update.unreadCount` is a delta;
  `messaging-history.set` is reverse chronological; `fetchMessageHistory` requires the oldest key
  plus millisecond timestamp; `downloadMediaMessage` requires the serialized `WebMessageInfo`;
  an interrupted pairing-code request can leave `registered: false` credentials with `creds.me`
  that must be reset before starting a fresh QR attempt; `@lid` identities must remain intact for
  provider addressing and are mapped separately to phone/contact labels for display;
  `messages.update` carries `update.status` as `WebMessageInfo.Status` (2 server ack, 3 delivery
  ack, 4 read, 5 played) and `message-receipt.update` carries per-participant
  `receiptTimestamp`/`readTimestamp` values.
