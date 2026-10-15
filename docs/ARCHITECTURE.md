# MultiOmon Architecture

## Scope

M00 provides only the desktop application skeleton. Accounts, domain models, persistence,
messaging providers, and WhatsApp connectivity are intentionally absent.

## Process boundaries

```text
Electron main process
  owns windows, OS access, IPC handlers, and future infrastructure
          │
          │ allow-listed, typed IPC
          ▼
Sandboxed preload
  exposes window.multiomon only
          │
          ▼
React renderer
  owns presentation and transient UI state; has no direct Node.js access
```

The main process creates windows with `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, and `webSecurity: true`. The preload exports an immutable `DesktopApi`; IPC channel
names and payload types are defined in `src/shared/contracts`.

## Source layout

```text
src/main/                 Electron lifecycle, windows, and privileged IPC
src/preload/              narrow context bridge
src/renderer/             React application and presentation
src/shared/               process-safe contracts and primitives
src/domain/               provider-independent domain model (reserved for M01)
src/application/          use cases and orchestration (reserved)
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

## Build and packaging

electron-vite produces separate main, preload, and renderer bundles in `out/`. electron-builder
packages those bundles for macOS, Windows, and Linux. Installers must be built and validated on the
corresponding platform before support is claimed.

## Testing boundaries

- Unit tests validate pure policy/configuration, including BrowserWindow security settings.
- Integration tests validate that React consumes only the typed bridge contract.
- Live WhatsApp connectivity is never required for normal tests.
