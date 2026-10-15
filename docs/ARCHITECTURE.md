# MultiOmon Architecture

## Scope

M02 provides the desktop shell, provider-independent messaging domain models, independently managed
mock sessions, and a durable SQLite application projection. Messaging providers and WhatsApp
connectivity are intentionally absent.

## Process boundaries

```text
Electron main process
  owns AccountManager, SQLite, repositories, mock sessions, IPC, and OS access
          │
          │ allow-listed, typed IPC
          ▼
Sandboxed preload
  exposes window.multiomon only
          │
          ▼
React renderer
  owns presentation and transient Zustand state; has no direct Node.js access
```

The main process creates windows with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, and `webSecurity: true`. The preload exports an immutable `DesktopApi`; IPC channel
names and payload DTOs are defined in `src/shared/contracts`. Domain objects do not cross IPC.

The SQLite connection, file path, migrations, SQL, and repository implementations remain entirely
in the main process. No database handle or filesystem path is exposed to the renderer.

## Multi-account ownership

```text
AccountManager (main process)
  ├── Account A ── InMemoryAccountSession A ── connection state A
  ├── Account B ── InMemoryAccountSession B ── connection state B
  └── Account C ── InMemoryAccountSession C ── connection state C
           │
           ▼ snapshot DTOs only
       preload bridge → Zustand → React account rail
```

Selecting an active account changes presentation context only. It never starts, stops, or replaces
another account's session. `connectAll` uses settled results so one rejected session cannot cancel
healthy sessions.

## Domain model

`src/domain` owns `Account`, `AccountConnectionState`, `Chat`, `Contact`, `Message`,
`MessageContent`, `Attachment`, `Reaction`, and `Receipt`. Each messaging entity carries an
`AccountId`. Branded internal IDs prevent accidental cross-entity substitution, while
`createScopedRemoteKey` provides deterministic account-namespaced remote identity.

## Source layout

```text
src/main/                 Electron lifecycle, windows, and privileged IPC
src/preload/              narrow context bridge
src/renderer/             React application and presentation
src/shared/               process-safe contracts and primitives
src/domain/               provider-independent messaging models and identity
src/application/          AccountManager, session boundary, and DTO mapping
src/infrastructure/       SQLite implementation; messaging and secure storage reserved
tests/unit/               isolated policy and domain tests
tests/integration/        cross-module and renderer integration tests
```

## Intended dependency direction

```text
renderer → shared contracts
main → application/domain + infrastructure + shared contracts
infrastructure → application/domain interfaces
preload → shared contracts
```

Future Baileys code must exist only below `src/infrastructure/messaging/whatsapp` and map protocol
objects to provider-independent application/domain values. Neither React nor general domain code may
import Baileys.

The M01 `ManagedAccountSession` is deliberately transport-neutral and backed only by
`InMemoryAccountSession`. M03 will introduce the formal messaging provider abstraction; M01 does not
preempt that provider API.

## Durable local projection

```text
domain/application repository interfaces
                 ▲
                 │ normalized domain values
                 │
SQLite repositories ── SqliteDatabase ── versioned migrations
                                            │
                                            ▼
                         userData/database/multiomon.sqlite
```

`better-sqlite3` is isolated below `src/infrastructure/database`. The connection enables foreign
keys, a five-second busy timeout, and WAL mode for file-backed databases. `SqliteDatabase` exposes a
small transaction runner; repositories convert between rows and domain values.

The initial schema contains `accounts`, `contacts`, `chats`, and `messages`. Messaging rows use
composite `(account_id, id)` primary keys, and remote message deduplication uses the unique key
`(account_id, remote_id)`. Foreign keys include account context so identical IDs in separate
accounts cannot collide.

Migrations are ordered, immutable code entries recorded in `schema_migrations`. Each unapplied
migration runs in its own SQLite transaction. Startup refuses databases newer than the application
rather than deleting or recreating them.

Message pages are ordered newest-first by `(sent_at DESC, id DESC)`. Cursors contain both values,
which provides stable pagination even when several messages share a timestamp. Page sizes are
bounded to 1–200.

## Build and packaging

electron-vite produces separate main, preload, and renderer bundles in `out/`. electron-builder
packages those bundles for macOS, Windows, and Linux. Installers must be built and validated on the
corresponding platform before support is claimed.

## Testing boundaries

- Unit tests validate pure policy/configuration, including BrowserWindow security settings.
- Domain tests validate connection transitions and account-scoped identity.
- Application tests validate multi-account connection, switching, and failure isolation.
- Integration tests validate that React consumes only typed account snapshot DTOs.
- Temporary-file database tests cover clean migration, version upgrades, transactions, restart
  persistence, multi-account isolation, deduplication, and cursor pagination.
- Live WhatsApp connectivity is never required for normal tests.
