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
