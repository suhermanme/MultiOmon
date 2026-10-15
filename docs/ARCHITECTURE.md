# MultiOmon Architecture

## Scope

M01 provides the desktop shell, provider-independent messaging domain models, an in-memory
multi-account manager, and renderer account switching. Persistence, messaging providers, and
WhatsApp connectivity are intentionally absent.

## Process boundaries

```text
Electron main process
  owns AccountManager, independent mock sessions, IPC, and OS access
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
src/infrastructure/       database, messaging, and secure storage adapters (reserved)
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

## Build and packaging

electron-vite produces separate main, preload, and renderer bundles in `out/`. electron-builder
packages those bundles for macOS, Windows, and Linux. Installers must be built and validated on the
corresponding platform before support is claimed.

## Testing boundaries

- Unit tests validate pure policy/configuration, including BrowserWindow security settings.
- Domain tests validate connection transitions and account-scoped identity.
- Application tests validate multi-account connection, switching, and failure isolation.
- Integration tests validate that React consumes only typed account snapshot DTOs.
- Live WhatsApp connectivity is never required for normal tests.
