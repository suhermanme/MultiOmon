# MultiOmon

MultiOmon is an unofficial, personal-use, cross-platform desktop client foundation for managing
multiple WhatsApp accounts. It targets macOS, Windows, and Linux.

> This project is not affiliated with, endorsed by, or associated with WhatsApp or Meta. The
> default build uses a deterministic mock messaging provider and does not connect to WhatsApp; the
> experimental Baileys transport is opt-in through `WHATSAPP_PROVIDER=1`.

## Current milestone

M07 adds production conversation hydration and pagination, account pairing/lifecycle controls,
media-message metadata with on-demand local caching, provider-backed older-history requests, and a
responsive three-column conversation UI. Normalized provider events flow through the application
layer into SQLite, then reach the read-only React projection through the typed preload bridge.

Local application data is stored below Electron's platform-specific `userData` directory in
`database/multiomon.sqlite`. Large media will use filesystem storage in a later milestone rather
than SQLite blobs.

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
