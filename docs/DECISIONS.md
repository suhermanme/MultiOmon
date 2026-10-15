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
