import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { createRnBridgeDriver } from './rnBridge.ts';

/** A stand-in app: connects to the bridge and answers snapshot with its own name. */
function fakeApp(port: number, name: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { id: number; op: string };
      ws.send(JSON.stringify({ id: msg.id, ok: true, result: [{ ref: '0', role: 'text', name, text: name }] }));
    });
    ws.on('open', () => resolve(ws));
  });
}

describe('rn-bridge driver', () => {
  it('settles on the app instance that stays when the app is relaunched right after start', { timeout: 20_000 }, async () => {
    const port = 4599;
    const driver = createRnBridgeDriver({ port, connectTimeoutMs: 5000 });
    const started = driver.start();
    const first = await fakeApp(port, 'first launch');
    await started;
    setTimeout(() => void fakeApp(port, 'relaunched'), 400); // e.g. a cloud's Appium starts the activity again
    const t0 = Date.now();
    await driver.settle(1000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1300); // waited out the reconnect, then 1 s of quiet
    expect((await driver.snapshot())[0]?.name).toBe('relaunched');
    first.close();
    await driver.stop();
  });
});
