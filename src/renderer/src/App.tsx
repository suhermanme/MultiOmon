import { useEffect, useState } from 'react';
import type { RuntimeInfo } from '../../shared/contracts/desktop-api';

type BridgeStatus =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready'; readonly runtime: RuntimeInfo }
  | { readonly kind: 'failed' };

export function App(): React.JSX.Element {
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ kind: 'checking' });

  useEffect(() => {
    let active = true;

    Promise.all([window.multiomon.ping(), window.multiomon.getRuntimeInfo()])
      .then(([response, runtime]) => {
        if (active && response === 'pong') setBridgeStatus({ kind: 'ready', runtime });
      })
      .catch(() => {
        if (active) setBridgeStatus({ kind: 'failed' });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="app-shell">
      <aside className="brand-rail" aria-label="Application identity">
        <div className="brand-mark" aria-hidden="true">
          M
        </div>
        <div className="rail-line" />
        <span className="milestone">M00</span>
      </aside>

      <section className="welcome-panel">
        <div className="eyebrow">Desktop foundation</div>
        <h1>MultiOmon</h1>
        <p className="lede">
          One calm desktop home for the conversations that matter across your accounts.
        </p>

        <div className="foundation-card">
          <div>
            <span className={`status-dot status-${bridgeStatus.kind}`} aria-hidden="true" />
            <strong>
              {bridgeStatus.kind === 'ready'
                ? 'Secure desktop bridge ready'
                : bridgeStatus.kind === 'failed'
                  ? 'Desktop bridge unavailable'
                  : 'Checking desktop bridge…'}
            </strong>
          </div>
          {bridgeStatus.kind === 'ready' && (
            <span className="runtime-label">
              {bridgeStatus.runtime.platform} · Electron {bridgeStatus.runtime.versions.electron}
            </span>
          )}
        </div>

        <p className="footnote">
          Account connections arrive in a later milestone. This build establishes the secure,
          cross-platform application shell.
        </p>
      </section>
    </main>
  );
}
