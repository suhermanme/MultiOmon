import { describe, expect, it } from 'vitest';
import { createWindowOptions } from '../../src/main/window-options';

describe('main window security policy', () => {
  it('isolates and sandboxes the renderer without Node integration', () => {
    const options = createWindowOptions('/safe/preload.js');

    expect(options.webPreferences).toMatchObject({
      preload: '/safe/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    });
  });
});
