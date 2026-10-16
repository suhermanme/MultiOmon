# Current State

## Current milestone

M07 — Media messages, provider history backfill, timeline polish, and responsive account UI are
implemented in the working tree on top of `6df2955` (M06). Live WhatsApp verification still requires
a physical phone; pairing has been exercised through code issuance but end-to-end linking and media
verification are still pending.

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
  history page, and open at least one image/audio/document attachment.
- Native installers have not been produced or validated on Windows or Linux.

## Next milestone scope (M08)

- Composer and user-facing text sending, including reply selection and optimistic/error states.
- Read receipts and mark-read behavior tied to the active conversation.
- Media sending can follow after the text composer path is stable.

## Not implemented

- User-facing message sending (the provider `sendText` path is currently test-only).
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

## Verification

- `npm run format` — passed.
- `npm run lint` — passed with zero errors and zero warnings.
- `npm run typecheck` — passed for node and web projects.
- `npm test` — 14 files and 103 tests passed without network access.
- `npm run build` — passed for main, preload, and renderer bundles; the sole Baileys dynamic import
  remains in the WhatsApp adapter.
- `npm run start` — mock-mode Electron shell launched on the local Wayland display without main or
  renderer errors; the process was stopped after the smoke check.
- `npm run package` and `npm run dist` — not run; only run on explicit request.

## Handover

- Branch `main` is at `6df2955 M06: add conversation synchronization and pagination UX`, matching
  `origin/main`. M07 and the UI repair are uncommitted. `.claude/` remains unrelated and untracked.
- Never commit or push unless explicitly requested. Commit subjects use `MNN: …` with no body.
- Gate order: `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm test` →
  `npm run build`.
- Keep Baileys runtime access confined to the one lazy `await import('@whiskeysockets/baileys')` in
  `WhatsappMessagingSession`; general application, domain, shared, and renderer code stay transport
  neutral.
- Baileys 6.7.x facts: pairing QR is on `connection.update`; `chats.update.unreadCount` is a delta;
  `messaging-history.set` is reverse chronological; `fetchMessageHistory` requires the oldest key
  plus millisecond timestamp; `downloadMediaMessage` requires the serialized `WebMessageInfo`;
  an interrupted pairing-code request can leave `registered: false` credentials with `creds.me`
  that must be reset before starting a fresh QR attempt; `@lid` identities must remain intact for
  provider addressing and are mapped separately to phone/contact labels for display.
