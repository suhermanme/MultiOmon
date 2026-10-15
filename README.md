# MultiOmon

MultiOmon is an unofficial, personal-use, cross-platform desktop client foundation for managing
multiple WhatsApp accounts. It targets macOS, Windows, and Linux.

> This project is not affiliated with, endorsed by, or associated with WhatsApp or Meta. The
> current build does not connect to WhatsApp; transport work is intentionally deferred.

## Current milestone

M01 establishes provider-independent messaging domain models and a main-process-owned
multi-account foundation. Three in-memory mock accounts connect independently and can be switched
from the account rail without disconnecting one another. SQLite and WhatsApp connectivity are not
implemented yet.

## Development

Requirements: a current Node.js LTS release and npm.

```sh
npm install
npm run dev
```

Quality and build commands:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
npm run package
```

`npm run package` creates an unpacked application for the current platform. `npm run dist` creates
configured installers for the current platform; cross-platform installers should be produced and
tested on their native operating systems or CI runners.

## Security posture

- Renderer Node integration is disabled.
- Context isolation and Electron sandboxing are enabled.
- Renderer-to-main communication uses a narrow typed preload API.
- New windows are denied; HTTPS links are delegated to the system browser.
- Runtime data, SQLite files, and credentials are ignored by Git.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/WORK_STATE.md](docs/WORK_STATE.md).

## License

Copyright (C) 2026 Muhammad Edy Suherman.

MultiOmon is licensed under the GNU General Public License version 3. See [LICENSE](LICENSE).
