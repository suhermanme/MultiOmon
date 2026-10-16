# OMP Handover — MultiOmon

Captured: 2026-10-16, machine `medys@darwin 27.0.0 arm64`, cwd `/Users/medys/Documents/04_OPREK/WORKSPACE/multiomon`.
No commits, pushes, stashes, resets, or discards were performed while preparing this file.

## 1. Current milestone and goal

**M05 — Real multi-account add/remove/logout UI with a WhatsApp pairing surface.** In progress, entirely
uncommitted. The working tree is **RED**: typecheck, lint, format, and one test all fail. M00–M04 are
committed and pushed.

Goal: let a user create, pair, connect, log out, and remove real accounts through the typed preload
bridge, see a QR code and pairing code in React, and keep Baileys behind ADR-012/ADR-014.

## 2. Git status

```
branch: main  (HEAD aac1f53 "M04: add Baileys messaging transport")
main...origin/main — in sync, nothing to push
staged 0 | unstaged 27 (26 M + 1 D) | untracked 6 | stash 0
```

Unstaged (modified): `docs/DECISIONS.md`, `docs/WORK_STATE.md`, `package.json`, `package-lock.json`,
`src/application/accounts/{account-manager,account-session,account-view}.ts`,
`src/application/messaging/{messaging-service,messaging-view,provider-account-session}.ts`,
`src/application/ports/messaging-provider.ts`, `src/domain/account.ts`,
`src/infrastructure/database/{account-repository,migrations}.ts`,
`src/infrastructure/messaging/mock/mock-messaging-provider.ts`,
`src/infrastructure/messaging/whatsapp/{whatsapp-messaging-provider,whatsapp-messaging-session}.ts`,
`src/main/{index,ipc}.ts`, `src/preload/index.ts`, `src/renderer/src/{App.tsx,account-store.ts}`,
`src/shared/contracts/desktop-api.ts`, `tests/integration/database.test.ts`,
`tests/unit/{mock-messaging-provider,whatsapp-messaging-session}.test.ts`.

Deleted: `src/main/mock-accounts.ts` (replaced by untracked `src/main/bootstrap.ts`).

Untracked: `src/application/accounts/account-provisioning.ts` (142 lines), `src/main/bootstrap.ts` (107),
`src/renderer/src/pairing-store.ts` (22), `tests/integration/account-pairing-flow.test.ts` (228),
`tests/unit/account-provisioning.test.ts` (332).

Diff size: 27 files, +1685 / −243. Commit style is a single-line `MNN: …` subject, no body.

## 3. Completed

Committed and pushed (M00–M04, `aac1f53`): secure Electron/React/strict-TS/Vite foundation; provider-independent
domain and main-process multi-account foundation; versioned SQLite persistence with account-scoped
repositories; application-owned `MessagingProvider`/`MessagingSession`/`MessagingEvent` contracts with one
independent session per account; `MockMessagingProvider`; `MessagingService` transactional chat/message
projection with account-scoped identity and remote deduplication; commit-before-notify ordering; typed IPC
queries plus projection subscription; Zustand messaging projection with stale-request protection; read-only
React conversation list and timeline; Baileys transport spike (`WhatsappMessagingProvider`,
`WhatsappMessagingSession`, per-account `useMultiFileAuthState` under `userData/authInfo/<accountId>/`,
`WHATSAPP_PROVIDER=1` opt-in).

Implemented in the working tree (code is written, gates are not green):

- `AccountProvisioningService` (`src/application/accounts/account-provisioning.ts`): `createAccount`,
  `restoreAccounts`, `removeAccount`, `logoutAccount`, `startPairing`, `connectAccount`;
  `AccountProvisioningError` codes `invalid-display-name | invalid-phone-number | missing-account`;
  display name capped at 64; phone normalized by stripping `[\s()-]` and validated against
  `/^\+?[0-9]{5,15}$/`.
- `src/main/bootstrap.ts` replaces `src/main/mock-accounts.ts`: `seedMockAccounts` (mock mode only),
  `createMockMessagingProvider`, `createWhatsappMessagingProvider(authDir, accounts)`, and
  `bootstrapApplication({ transactionRunner, repositories, messagingProvider, useWhatsapp })` returning
  `{ messagingService, accountManager, provisioning }`. Startup `connectAll()` is now gated to
  `!useWhatsapp`, which fixes the M04 known issue of live unpaired sockets at boot.
- `ManagedAccountSession` gained `startPairing()`, `logout()`, `dispose()`; `InMemoryAccountSession`
  implements them. `AccountManager` gained `startPairing`, `logoutAccount`, `hasAccount`, and now calls
  `entry.session.dispose()` on remove.
- `MessagingSession` port gained `dispose(): void`; implemented in the mock session and the WhatsApp session
  with a `#disposed` guard that throws `ProviderError('session-disposed')`. `MessagingService.dispose()` and
  its per-account removal dispose both the managed session and the provider session.
- `MessagingEvent` gained the `pairing.qr` variant (`{ type, accountId, payload }`);
  `toPairingUpdateDto` in `messaging-view.ts` maps `pairing.code` → `{ kind: 'code', code, expiresAt }` and
  `pairing.qr` → `{ kind: 'qr', payload }`. `MessagingService.subscribePairing()` added.
- `src/main/ipc.ts`: `registerIpcHandlers(services: IpcServices)` options object (now includes
  `provisioning`); new handlers `accounts:create`, `accounts:remove`, `accounts:logout`, `accounts:pair`,
  `accounts:connect` and `pairing:changed`; shared `readAccountId` / `readAccountRequest` validation;
  `sendToWindows`; `publishAccounts` tracks per-account connection state and emits
  `{ kind: 'cleared' }` on `pairing:changed` only when a pairing panel was actually open (transition into
  `connected | disconnected | failed`) or the account disappears; all new handlers are unregistered in the
  teardown closure.
- `src/preload/index.ts`: `accounts.create/remove/logout/pair/connect` and `pairing.subscribe`.
- `src/renderer/src/App.tsx`: `AddAccountForm` (name + optional phone), `AccountActions`
  (Pair / Connect / Log out / Remove with inline confirm), `PairingQr` rendering the payload via
  `QRCode.toString(payload, { type: 'svg' })` into an `img` data URL, account phone display.
- `src/renderer/src/pairing-store.ts`: Zustand pairing state + `subscribePairing`.
- `src/domain/account.ts`: `Account.phoneNumber?`; migration **v3 `add_account_phone_number`**
  (`ALTER TABLE accounts ADD COLUMN phone_number TEXT`); `account-repository.ts` maps the column.
- `WhatsappMessagingSession`: `#subscribeToEvents()` is now actually called and subscribes `qr`,
  `connection.update`, `chats.upsert`, `messages.upsert`; cancellable exponential-backoff reconnect
  (`#scheduleReconnect` / `#cancelReconnect`) replacing the M04 5-second `setTimeout`; Boom
  `output.statusCode === 401` → `failed`/`auth-failure` with **no** reconnect; `dispose()`;
  `#cleanupSocket()` removes all five listeners and calls `socket.end(undefined)`;
  `#removeAuthDirectory()` on logout.
- Dependencies added: `qrcode@^1.5.4`, `@types/qrcode@^1.5.6`.
- New tests written: `tests/unit/account-provisioning.test.ts`, `tests/integration/account-pairing-flow.test.ts`.

## 4. Partially completed (the exact cut point)

The session stopped mid-refactor of the connection-state DTO. Everything below is real, observed breakage.

1. **`AccountConnectionStateDto` was deleted from `src/shared/contracts/desktop-api.ts` and never
   re-added.** Still referenced at `desktop-api.ts:22` (inside `AccountSummaryDto`), `src/main/ipc.ts:10`
   (imported, used as `AccountConnectionStateDto['kind']`), and `src/renderer/src/App.tsx:4`.
   `ipc.ts` expects an object with a `kind` field; `account-view.ts` still emits
   `connectionState: connectionState.kind` (a bare string). The intended migration is string union →
   discriminated DTO carrying `kind` plus the `AccountConnectionState` detail fields
   (`attempt`, `errorCode`, `message`, `reason`, `connectedAt`, `changedAt`).
2. **`src/renderer/src/account-store.ts` is half-written**: `snapshot: emptySnapshot` at line 51 references
   an undefined name; `requestLifecycleSnapshot` (line 43) is declared but never used — the
   `pairAccount` / `connectAccount` actions (which resolve to `void` and must re-fetch
   `accounts.getSnapshot()`) are unfinished. This also throws at store creation in vitest.
3. **Baileys `qr` event does not type-check** in `whatsapp-messaging-session.ts`: `TS2345` at 382 and 453
   (`'qr'` is not a `keyof BaileysEventMap` in the installed typings) and `TS2322` at 383 (handler param
   inferred as the whole event-value union). Runtime subscription is written; only the typing is unresolved.
4. **`tests/integration/renderer-shell.test.tsx:43`** fake bridge lacks the new `create`, `remove`,
   `logout`, `pair`, `connect` members.
5. **`tests/integration/whatsapp-messaging-flow.test.ts:40`** passes `() => {}` where
   `WhatsappProviderOptions` is now an object type (`TS2560`).
6. **One failing test**: `tests/unit/whatsapp-messaging-session.test.ts:449` "keeps backing off when a
   reconnect attempt fails to initialize" expects `['connecting', 'disconnected']`, receives `['connecting']`
   — the backoff path no longer re-announces `disconnected` after a failed re-initialize.
7. **33 ESLint errors**: `@typescript-eslint/require-await` on intentionally-async mock methods in
   `tests/unit/mock-messaging-provider.test.ts` (58, 63, 71, 75), `tests/unit/account-provisioning.test.ts`
   (57, 62, 68, 77, 82), `tests/unit/whatsapp-messaging-session.test.ts` (67, 70, 74, 88, 96, 101); plus
   `no-unsafe-assignment` at `whatsapp-messaging-session.test.ts:393` and `:399`.
8. **6 files fail `prettier --check`**: `src/application/accounts/account-provisioning.ts`,
   `src/main/bootstrap.ts`, `src/main/ipc.ts`, `src/renderer/src/account-store.ts`,
   `tests/unit/account-provisioning.test.ts`, `tests/unit/mock-messaging-provider.test.ts`.
9. **Docs are stale**: `docs/WORK_STATE.md` still claims "M05 — not started" and "working tree is clean".
   `docs/DECISIONS.md` has ADR-014/015/016 added but uncommitted, and no ADR yet for the M05 decisions
   (provisioning service ownership, DTO-based connection state, startup `connectAll` gating).

## 5. Exact remaining work

1. Re-add `AccountConnectionStateDto` in `src/shared/contracts/desktop-api.ts` as a discriminated DTO;
   update `toAccountSnapshotDto` (`account-view.ts`) to emit it; update `App.tsx` / `account-store.ts` /
   `pairing-store.ts` consumers and the `CLOSED_PAIRING_STATES` typing in `ipc.ts`.
2. Finish `account-store.ts`: define `emptySnapshot`, wire `pairAccount` and `connectAccount` through
   `requestLifecycleSnapshot` (call → re-fetch snapshot), keep `pendingAction`/error handling.
3. Fix the Baileys `qr` subscription typing without importing Baileys values outside the ADR-014 site
   (narrow the event name/handler locally inside `whatsapp-messaging-session.ts`).
4. Update `tests/integration/renderer-shell.test.tsx` fake bridge with `create/remove/logout/pair/connect`;
   fix `whatsapp-messaging-flow.test.ts:40` to pass a real `WhatsappProviderOptions` object.
5. Resolve the reconnect-backoff behavior or its assertion at `whatsapp-messaging-session.test.ts:449` —
   decide whether a failed re-initialize must publish `disconnected` (preferred: it should, so the UI can
   show retry state), then make the session and test agree.
6. Clear the 33 ESLint errors (`require-await` on test doubles — prefer `async` + `await Promise.resolve()`
   or drop `async` and return `Promise.resolve(...)`; type the two `any` assignments) and run
   `npm run format`.
7. Verify the pairing UI end to end: `npm run dev` with `WHATSAPP_PROVIDER=1`, add an account with a real
   phone number, press Pair, confirm a QR and a pairing code reach the renderer, confirm `pairing:changed`
   `{ kind: 'cleared' }` on connect/failure/removal.
8. Update `docs/WORK_STATE.md` (milestone, in-progress, verification) and `docs/DECISIONS.md` (new ADRs for
   provisioning ownership, DTO connection state, startup gating) in the same pass as the code.
9. Re-run the full gate order, then hand the diff back for review. **Do not commit or push unless explicitly
   asked.**

## 6. Important architectural decisions

Committed ADRs 001–013 (see `docs/DECISIONS.md`): sandboxed typed preload bridge (001); no infrastructure
types in `src/shared` (002); separate node/web compilation contexts (003); reserved directories (004);
GPL-3.0-only (005); account-scoped branded identity (006); main-process account ownership with snapshot
DTOs (007); one independent mutable session per account (008); synchronous `better-sqlite3` behind
repository ports (009); forward-only transactional migrations, refuse newer DB (010); composite persistence
identity `(account_id, id)` / `(account_id, remote_id)` and `(sent_at, id)` keyset cursors (011).

Uncommitted ADRs 014–016: Baileys is reached only through the single lazy `await import()` inside
`src/infrastructure/messaging/whatsapp/whatsapp-messaging-session.ts` — type-only imports allowed in that
directory, no Baileys value or type in `src/domain`, `src/application`, `src/shared`, or the renderer (014);
live WhatsApp transport is opt-in via `WHATSAPP_PROVIDER === '1'`, no test performs network access (015);
Baileys `engine-requirements.js` and `protobufjs/scripts/postinstall.js` install scripts stay blocked (016).

M05 decisions made in code but not yet written as ADRs:

- **Provisioning is an application service, not an IPC concern.** `AccountProvisioningService` owns
  validation, ID minting, persistence, and session lifecycle; `ipc.ts` only validates wire input and calls
  it. `AccountManager` stays the session registry.
- **Pairing is an explicit user action.** Startup `connectAll()` runs only in mock mode; WhatsApp mode never
  dials stored accounts unattended.
- **Pairing UI state is derived from connection-state transitions**, published as a small
  `pairing:changed` hint (`code | qr | cleared`) rather than a renderer-owned session.
- **SQLite remains the only renderer source** (ADR-013); pairing hints are ephemeral UI signals, not
  persisted rows.
- Constraints the WhatsApp transport must keep honoring: top-level `import type` only, no dynamic import
  outside the single ADR-014 site, `consistent-type-imports`, `no-explicit-any`,
  `eslint . --max-warnings=0`. `no-unnecessary-condition` is not enabled, so defensive `?.` is fine.
- Gate order: `npm run format:check` → `npm run lint` → `npm run typecheck` → `npm test` → `npm run build`.
  `npm run package` / `npm run dist` only on request after a green build.

## 7. Current test / typecheck / build status

Measured 2026-10-16 on the dirty tree (Node v26.10.0, npm 11.19.1):

| Gate                                       | Result                                                              |
| ------------------------------------------ | ------------------------------------------------------------------- |
| `npm run format:check`                     | FAIL — 6 files unformatted                                          |
| `npm run lint`                             | FAIL — 33 errors, 0 warnings                                        |
| `npm run typecheck`                        | FAIL — 10 errors (see §4 items 1–3, 4, 5)                           |
| `npm test`                                 | FAIL — 12 files: 10 passed, 2 failed; 69 tests: 68 passed, 1 failed |
| `npm run build`                            | FAIL — aborts in its `typecheck` step before `electron-vite build`  |
| `npm run package` / `npm audit --omit=dev` | Not re-run since Baileys was added                                  |

Last green state was `aac1f53` (M04): 10 files / 38 tests passing, all gates green.

## 8. Instructions for the next OMP session

1. `git status` first: expect exactly 27 unstaged + 6 untracked, nothing staged, no stash, `main` in sync
   with `origin/main`. If it differs, stop and report — do not "fix" it with git.
2. **Never commit, push, stash, reset, checkout, or discard.** The entire M05 implementation exists only in
   the working tree; a `git stash` or `git checkout .` destroys it.
3. Install: `npm ci` (or `npm install`). `better-sqlite3@13.0.3` is native and must build for the local
   toolchain; `package.json` `allowScripts` permits `electron`, `esbuild`, `electron-winstaller`, `fsevents`,
   `better-sqlite3` only. Baileys and protobufjs install scripts stay blocked by ADR-016 — do not relax the
   policy. Development toolchain here is Node v26.10.0; `package.json` declares no `engines` field.
4. Reproduce the red state before changing anything: `npm run typecheck` and `npm test`. Confirm the errors
   match §4/§7. Do not treat them as pre-existing noise.
5. Fix in dependency order: §5 item 1 (DTO) → item 2 (account-store) → item 3 (Baileys `qr` typing) →
   items 4–6 (tests, lint, format) → item 7 (manual pairing smoke) → item 8 (docs).
6. Keep ADR-012/014 isolation: no Baileys type or value outside
   `src/infrastructure/messaging/whatsapp/whatsapp-messaging-session.ts` (type-only imports allowed in that
   directory); no Electron or SQLite types in `src/shared/contracts`.
7. No test may perform network access. Live WhatsApp behavior is verified only through an explicit
   `WHATSAPP_PROVIDER=1` manual run.
8. Baileys 6.7.x facts that cost debugging time: `WASocket = ReturnType<typeof makeWASocket>`;
   `requestPairingCode(phoneNumber, customPairingCode?)`; `sendMessage` resolves to a single
   `proto.WebMessageInfo | undefined`; `auth` must be `{ creds, keys }`; there is no chat store on the
   socket; only `socket.ev.on` exists and `removeAllListeners` requires an event name; disconnect errors are
   `@hapi/boom` Booms carrying `output.statusCode`; `lastDisconnect.date`, not `timestamp`;
   `socket.end(undefined)` requires the argument; `Chat` has `conversationTimestamp` but no
   `notify`/`lastAlwaysAt`; `DisconnectReason.loggedOut` is a value export, so the `401` literal is kept to
   avoid crossing ADR-014.
9. Known issues still open from M04: old M02 development databases keep their seed message alongside
   provider events (intentional); no Windows/Linux installers validated; no signing/notarization or artwork;
   `npm audit` reports 8 moderate findings in electron-builder's dev-only chain (26.15.3 stays pinned);
   renderer CSP allows WebSocket in development for Vite HMR and needs a stricter production CSP.
10. Standing rule: when M05 completes, update `docs/DECISIONS.md` and `docs/WORK_STATE.md` in the same pass,
    re-run the gates, then report. Commit only if explicitly asked.

## 9. Ready-to-paste resume prompt

```text
Resume MultiOmon M05 from the uncommitted working tree. Read docs/OMP_HANDOVER.md first, then
docs/WORK_STATE.md and docs/DECISIONS.md.

State to expect: branch main at aac1f53, in sync with origin/main, 27 unstaged modifications, 6 untracked
files (src/application/accounts/account-provisioning.ts, src/main/bootstrap.ts,
src/renderer/src/pairing-store.ts, tests/integration/account-pairing-flow.test.ts,
tests/unit/account-provisioning.test.ts), src/main/mock-accounts.ts deleted, nothing staged, no stash.
Gates are red: prettier 6 files, eslint 33 errors, typecheck 10 errors, vitest 1 failing test
(tests/unit/whatsapp-messaging-session.test.ts:449).

Never commit, push, stash, reset, checkout, or discard anything.

Run npm ci, then reproduce the failures with npm run typecheck and npm test. Fix in this order:
1) re-add AccountConnectionStateDto in src/shared/contracts/desktop-api.ts as a discriminated DTO and
   finish its consumers (account-view.ts, main/ipc.ts, App.tsx, account-store.ts, pairing-store.ts);
2) finish src/renderer/src/account-store.ts (define emptySnapshot, wire pairAccount/connectAccount through
   requestLifecycleSnapshot);
3) fix the Baileys 'qr' subscription typing in whatsapp-messaging-session.ts without moving Baileys types
   out of that file (ADR-012/ADR-014);
4) update tests/integration/renderer-shell.test.tsx (add create/remove/logout/pair/connect to the fake
   bridge) and tests/integration/whatsapp-messaging-flow.test.ts:40 (real WhatsappProviderOptions);
5) resolve the reconnect-backoff assertion at whatsapp-messaging-session.test.ts:449 — a failed
   re-initialize should publish 'disconnected';
6) clear the 33 ESLint errors and run npm run format;
7) smoke the pairing UI with npm run dev and WHATSAPP_PROVIDER=1: add an account with a real phone number,
   press Pair, confirm QR + pairing code render and that pairing:changed 'cleared' fires on
   connect/failure/removal;
8) update docs/WORK_STATE.md and docs/DECISIONS.md (ADRs for provisioning ownership, DTO connection state,
   startup connectAll gating).

Finish with the full gate order: npm run format:check, npm run lint, npm run typecheck, npm test,
npm run build. Report results and the remaining diff. Do not commit unless I explicitly ask.
```
