# Architecture Decisions

## ADR-001 — Secure Electron process isolation

Decision:
The renderer runs sandboxed with context isolation enabled and Node integration disabled. A narrow,
immutable preload API is the only renderer bridge.

Reason:
Messaging content is untrusted input, and privileged desktop capabilities must not be directly
available to renderer code.

Consequences:
Every cross-process operation requires an explicit typed contract and allow-listed IPC handler.

## ADR-002 — Shared contracts contain no infrastructure types

Decision:
IPC and future provider contracts use application-owned TypeScript types under `src/shared` or the
domain/application layers.

Reason:
This keeps Electron, database, and future Baileys details from leaking across boundaries.

Consequences:
Infrastructure adapters require mapping code, but transports can be replaced without rewriting UI
or domain logic.

## ADR-003 — Separate build graphs for privileged and web code

Decision:
Use electron-vite with strict Node and renderer TypeScript configurations, and electron-builder for
production packaging.

Reason:
Main/preload and renderer have different runtime capabilities. Separate type environments help
prevent accidental Node usage in the renderer while retaining a small toolchain.

Consequences:
Shared contracts must remain compatible with both compilation targets, and packaging is performed
from generated `out` bundles.

## ADR-004 — Architecture directories are reserved before implementation

Decision:
Reserve domain, application, database, messaging, and storage directories in M00 without adding
speculative abstractions.

Reason:
The intended subsystem boundaries should be visible immediately, while their APIs should be driven
by the requirements of their own milestones.

Consequences:
Some directories contain only placeholders until later milestones.

## ADR-005 — GPL version 3 licensing

Decision:
License MultiOmon under the GNU General Public License version 3 only (`GPL-3.0-only`).

Reason:
The project owner selected GPL version 3 for distribution and modification of the application.

Consequences:
Distributed derivative works must comply with GPL version 3, including its corresponding-source
requirements.

## ADR-006 — Account-scoped domain identity

Decision:
Every messaging domain entity carries an `AccountId`; internal entity IDs use branded types and
remote identifiers are namespaced by account.

Reason:
The same WhatsApp remote identifier may appear in multiple linked accounts and must never collide
or be routed through the wrong account.

Consequences:
Repositories and provider adapters must always supply account context, and explicit mapping is
required at serialization boundaries.

## ADR-007 — Main-process account ownership

Decision:
The `AccountManager` and each mutable account session live in the Electron main process. The
renderer receives immutable account snapshot DTOs through the preload bridge and stores only UI
projection state in Zustand.

Reason:
Session lifecycle and connection state are privileged application concerns; renderer compromise or
navigation must not expose or own session internals.

Consequences:
Account actions require typed IPC operations. Renderer account selection cannot directly mutate or
disconnect a session.

## ADR-008 — One independent session per account

Decision:
`AccountManager` stores a separate `ManagedAccountSession` for every account and coordinates batch
connection with settled results rather than shared mutable connection state.

Reason:
A connection failure or state transition for one account must not terminate or overwrite another.

Consequences:
Session events are projected into manager snapshots independently. Later providers must retain this
one-session-per-account lifecycle.

## ADR-009 — Synchronous SQLite behind repository ports

Decision:
Use `better-sqlite3` only in the Electron main process, behind application-owned typed repository
interfaces and a transaction runner.

Reason:
SQLite operations are short local transactions, and the synchronous API gives explicit transaction
boundaries without adding an ORM or leaking SQL concerns into domain/application code.

Consequences:
Long-running database work must be measured and kept off latency-sensitive paths. The native module
must be rebuilt for each packaged Electron target.

## ADR-010 — Forward-only transactional migrations

Decision:
Store ordered migration versions in `schema_migrations` and apply each missing migration in a
transaction. Refuse a database whose recorded version is newer than the application.

Reason:
Schema upgrades must preserve user data and fail visibly; destructive automatic recreation is not
acceptable.

Consequences:
Applied migration SQL is immutable. Schema corrections require a new migration version.

## ADR-011 — Composite persistence identity and keyset pagination

Decision:
Use `(account_id, id)` for persisted messaging identities, `(account_id, remote_id)` for remote
uniqueness, and `(sent_at, id)` cursors for message pagination.

Reason:
External IDs may repeat across accounts, provider events may be delivered more than once, and
timestamps alone do not define stable ordering.

Consequences:
Every repository query requires account context. Duplicate protocol messages become no-op inserts,
and pagination remains deterministic when timestamps match.

## ADR-012 — Application-owned messaging provider contract

Decision:
Define `MessagingProvider`, account-scoped `MessagingSession`, normalized provider values, and a
discriminated `MessagingEvent` union in the application layer. Infrastructure implementations must
adapt their protocol into this contract.

Reason:
Baileys is replaceable infrastructure. Domain, application services, IPC, and React must not depend
on its objects, lifecycle conventions, or serialization format.

Consequences:
Each account receives an independent provider session. Adapter mapping is mandatory, and new
provider capabilities are added to the application contract only when a milestone requires them.

## ADR-013 — Commit provider events before renderer notification

Decision:
Validate account ownership and persist normalized chat/message events in a SQLite transaction
before publishing a small projection-change hint. The renderer responds by querying durable DTOs
through the preload bridge.

Reason:
SQLite is the durable application projection and must remain the source for renderer state. Direct
provider-to-React delivery could display uncommitted events, bypass deduplication, and couple UI
lifetimes to transport lifetimes.

Consequences:
Repeated protocol messages become silent no-op inserts, renderer refreshes always observe committed
state, and provider events require explicit domain-to-persistence mapping.

## ADR-014 — Baileys is loaded lazily inside the WhatsApp adapter only

Decision:
`@whiskeysockets/baileys` is the WhatsApp transport. It is reached through a single lazy
`await import()` inside `src/infrastructure/messaging/whatsapp/whatsapp-messaging-session.ts`. Other
files in that directory may use type-only imports, and no Baileys value or type may enter
`src/domain`, `src/application`, `src/shared`, or the renderer.

Reason:
Baileys is a large protocol-specific dependency whose surface shifts between releases: there is no
chat store on the socket, events exist only on `socket.ev`, disconnect errors are `@hapi/boom` Booms,
and `sendMessage` resolves to a single `WebMessageInfo`. Loading it on first WhatsApp use keeps it out
of the startup bundle and keeps ADR-012 isolation enforceable at one import site.

Consequences:
Every Baileys API correction lives in one adapter file, and a version upgrade requires re-verifying
the published typings. Packaged builds must ship the dependency as an external runtime module instead
of bundling it into `out/main/index.js`.

## ADR-015 — Live WhatsApp transport is opt-in

Decision:
The main process selects the WhatsApp provider only when `process.env.WHATSAPP_PROVIDER === '1'`;
otherwise the deterministic mock provider is used. No automated test performs network access.

Reason:
A live WhatsApp session performs real device registration against Meta, cannot be reproduced in CI,
and must not become the default path while the UI and test suite are still mock-driven.

Consequences:
Transport selection is process-wide rather than per account, the WhatsApp path is exercised only by
explicit opt-in runs, and startup account seeding applies to whichever provider is selected.

## ADR-016 — Dependency install scripts stay blocked

Decision:
The blocked npm install scripts for Baileys `engine-requirements.js` and
`protobufjs/scripts/postinstall.js` remain blocked.

Reason:
Both are no-ops on the Node 26 toolchain used for development: the Baileys script only errors below
Node 20, and the protobufjs script returns early when the package declares no version scheme.
Allowing them would widen the supply-chain attack surface for no functional gain.

Consequences:
A future dependency that genuinely needs an install-time build must be reviewed and allowed
individually rather than by relaxing the global policy.

## ADR-017 — Account provisioning is an application service

Decision:
`AccountProvisioningService` (`src/application/accounts/account-provisioning.ts`) owns account
creation, restore, removal, logout, pairing, and connect: validation, ID minting, persistence, and
session lifecycle. `src/main/ipc.ts` only validates wire input and delegates to it, and
`AccountManager` remains the session registry.

Reason:
The lifecycle rules (display-name cap, phone normalization and validation, missing-account errors,
session disposal ordering) are application behavior. Keeping them out of IPC makes them testable
without Electron and keeps `ipc.ts` a thin wire adapter.

Consequences:
IPC handlers stay uniform (`readAccountId` / `readAccountRequest` validation, then one service
call), provisioning errors surface as `AccountProvisioningError` codes, and any new mutating
account channel must route through the provisioning service rather than touching repositories or
sessions directly.

## ADR-018 — Connection state crosses the bridge as a discriminated DTO

Decision:
`AccountConnectionStateDto` in `src/shared/contracts/desktop-api.ts` mirrors the domain
`AccountConnectionState` union: a discriminated object carrying `kind` plus the variant detail
fields (`changedAt`, `attempt`, `connectedAt`, `reason`, `errorCode`, `message`).
`toAccountSnapshotDto` emits the whole object instead of the bare `kind` string.

Reason:
The renderer needs the detail fields to explain lifecycle state — retry attempt counts, failure
codes, disconnect reasons — and a bare string discards them at the boundary. Mirroring the domain
union keeps one shape on both sides of the bridge without leaking domain or infrastructure types
(ADR-002, ADR-007).

Consequences:
Renderer consumers read `connectionState.kind` for status labels and CSS classes, and variant
fields become available to pairing/retry UI without new IPC channels. Adding a domain state
variant requires updating the DTO in the same pass.

## ADR-019 — Pairing is an explicit user action

Decision:
Startup `AccountManager.connectAll()` runs only in mock mode. In `WHATSAPP_PROVIDER=1` mode the app
never dials stored accounts unattended; connecting or pairing happens only through the
`accounts:pair` and `accounts:connect` channels invoked by the UI.

Reason:
An unattended Baileys connect for an unpaired account performs a real device-registration handshake
against Meta at every boot (the M04 known issue) and re-triggers reconnect timers the user never
asked for. Pairing is a deliberate, user-initiated flow with a visible QR and pairing code.

Consequences:
WhatsApp-mode accounts start `idle` or `needsPairing` and stay there until the user acts; the
pairing panel is driven by `pairing:changed` hints derived from connection-state transitions, and
mock-mode startup auto-connect behavior is preserved for deterministic tests.

## ADR-020 — Baileys history sync maps onto the existing MessagingEvent vocabulary

Decision:
`messaging-history.set` and `chats.upsert` are translated into the existing `chat.upserted` and
`message.upserted` events inside `WhatsappMessagingSession`; no hydration-specific event variant is
added to the provider contract.

Reason:
Hydration is just an earlier source of the same facts the projection already consumes. Mapping onto
existing events routes history through the identical transactional commit path (ADR-013), keeps the
mock provider behaviorally equivalent to WhatsApp, and avoids a second persistence path for synced
chats.

Consequences:
A connect can emit hundreds of events in one burst; the session keeps a `#knownChats` cache of
normalized provider chats so deltas after hydration merge against a correct base across reconnects.

## ADR-021 — Unread counts are provider-authoritative deltas

Decision:
`MessagingService.#projectMessage` never increments `unreadCount` on an existing chat. In the
WhatsApp session, `chats.update.unreadCount` is added to the cached base as a delta, `null`/`0` are
absolute marks-read, and protobuf Long values (absolute server payloads) replace it. A chat created
from a projected message gets `1` for incoming and `0` for outgoing.

Reason:
Baileys computes unread itself: `process-message.js` builds `unreadCount: (chat.unreadCount || 0) + 1`
per incoming message and `event-buffer.js` merges those patches additively, while
`chat-utils.js` resets to 0 on mark-read. Incrementing again in the projection double-counts.

Consequences:
Unread accuracy depends on the session's `#knownChats` base being current; a session restart before
the next `chats.upsert`/history sync can undercount until the provider re-asserts the absolute value.

## ADR-022 — Chat pagination is keyset on COALESCE(last_activity_at, 0) DESC with id tiebreak

Decision:
`ChatRepository.listByAccount` is replaced by `listPage(accountId, limit?, cursor?)` with cursor
`{ lastActivityAt, chatId }`, limit clamped to 1..200, ordering
`COALESCE(last_activity_at, 0) DESC, id DESC`, and migration v4 rebuilding
`chats_by_account_activity` to match.

Reason:
OFFSET pagination shifts rows under concurrent upserts and forces re-scans on long histories; keyset
predicates (`activity < cursor OR (activity = cursor AND id < cursorChat)`) are stable and index
backed. `COALESCE` puts chats with no recorded activity last deterministically, and the `id`
tiebreak makes the order total for equal timestamps.

Consequences:
The renderer loads conversations page-by-page via `nextCursor`; IPC validates page options before
they reach the view, and any new ordering requirement needs a matching index migration.

## ADR-023 — Messaging change notifications are coalesced per account and chat

Decision:
`src/main/ipc.ts` buffers `MessagingService` projection changes in a microtask-coalesced map keyed
by `accountId` + `chatId` and sends one `messaging:changed` batch (an array of `MessagingChangeDto`)
per burst instead of one IPC event per change.

Reason:
History hydration and bulk incoming messages commit dozens to hundreds of events in one tick;
per-event IPC would make every renderer reload race a per-event store refresh. Coalescing preserves
ADR-013 ordering (events fire only after commit) while bounding bridge traffic.

Consequences:
The preload `messaging.subscribe` listener receives arrays, and the store reloads once per batch;
per-chat keys mean a burst touching several chats yields one entry per chat, not a global reload.

## ADR-024 — Media metadata is durable; media bytes are cached on demand

Decision:
Provider media messages project a deterministic attachment ID into `messages` and a separate
`attachments` row introduced by migration v5. The row stores transport-neutral metadata and an
opaque provider reference. Bytes are downloaded only after a user action, written beneath
`userData/media/<accountId>/` through `MediaFileStore`, and served to the renderer through the typed
bridge without exposing the local path.

Reason:
Putting large encrypted media payloads in SQLite would inflate the projection and make routine chat
queries expensive. Keeping the provider reference opaque preserves the application/provider
boundary while still allowing the WhatsApp adapter to reconstruct the Baileys message required by
`downloadMediaMessage`.

Consequences:
Media metadata remains visible offline; opening uncached media requires a connected provider
session. A missing cache file is recoverable by downloading it again, and account removal deletes
that account's media directory.

## ADR-025 — Older history is requested from the oldest durable message

Decision:
`MessagingService.requestHistory` resolves the account-scoped chat and its oldest projected message,
then asks the active provider session for the preceding page. The WhatsApp adapter maps that request
to `fetchMessageHistory` and lets the resulting history events flow through the normal projection
pipeline.

Reason:
Using a durable message as the provider cursor makes requests stable across renderer reloads and
keeps provider-specific keys out of IPC. Reusing the existing event path preserves transactional
deduplication and change batching.

Consequences:
History backfill requires at least one local anchor message and a connected session. The provider
does not expose a definitive end-of-history flag, so the UI offers another explicit request after
the local page is exhausted.

## ADR-026 — Media rendering remains capability-scoped through IPC

Decision:
The renderer receives attachment metadata in `MessageDto` and invokes `messaging.downloadMedia`
with only an account ID and attachment ID. The main process validates ownership, retrieves or caches
the bytes, and returns a MIME-qualified data URL for the selected attachment.

Reason:
Neither absolute filesystem paths nor arbitrary read capabilities belong in the sandboxed renderer.
The typed command keeps access account-scoped and user-initiated while supporting native image,
video, audio, sticker, and document controls.

Consequences:
Downloaded bytes cross IPC once when opened; a future streaming protocol can replace data URLs for
very large media without changing the durable attachment model.
