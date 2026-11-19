import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cloudUse } from './playwright.ts';

function configWithCloudTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-ai-pw-'));
  const file = join(dir, 'e2e-ai.config.json');
  writeFileSync(
    file,
    JSON.stringify({
      model: { provider: 'openai', endpoint: 'http://127.0.0.1:1/v1', name: 'm' },
      docs: { api: [], guide: 'guide.md' },
      api: { baseUrl: 'http://127.0.0.1:1' },
      targets: {
        web: { platform: 'web', driver: { type: 'mcp', command: 'node', args: [] } },
        'web-browserstack': {
          platform: 'web',
          driver: { type: 'mcp', command: 'node', args: [] },
          cloud: { provider: 'browserstack', username: 'u', accessKey: 'k', hub: 'ws://127.0.0.1:1/' },
        },
      },
    }),
  );
  return file;
}

describe('cloudUse', () => {
  const saved = process.env.E2E_TARGET;
  afterEach(() => {
    if (saved === undefined) delete process.env.E2E_TARGET;
    else process.env.E2E_TARGET = saved;
  });

  it('keeps the browsers local unless E2E_TARGET names a cloud target', () => {
    delete process.env.E2E_TARGET;
    const file = configWithCloudTarget();
    expect(cloudUse(file)).toEqual({});
    expect(cloudUse(file, 'web')).toEqual({});
  });

  it('connects to the vendor for a named cloud target', () => {
    const file = configWithCloudTarget();
    process.env.E2E_TARGET = 'web-browserstack';
    expect(cloudUse(file)).toHaveProperty('connectOptions.wsEndpoint');
  });
});
