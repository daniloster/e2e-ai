// @vitest-environment node
import firebasePackage from 'firebase/package.json' with { type: 'json' };
import { describe, expect, it, vi } from 'vitest';

import { firebaseFromCdn } from './firebaseFromCdn';

function resolver(plugin: ReturnType<typeof firebaseFromCdn>) {
  const hook = plugin.resolveId!;
  const fn = typeof hook === 'function' ? hook : hook.handler;
  const warn = vi.fn();
  const resolve = (id: string) =>
    (
      fn as unknown as (this: unknown, id: string, importer: undefined, options: object) => unknown
    ).call({ warn }, id, undefined, { isEntry: false, attributes: {} });
  return { resolve, warn };
}

describe('firebaseFromCdn', () => {
  it('maps firebase/<x> to the gstatic URL for the given version', () => {
    const { resolve } = resolver(firebaseFromCdn({ version: '1.2.3' }));
    expect(resolve('firebase/app')).toEqual({
      id: 'https://www.gstatic.com/firebasejs/1.2.3/firebase-app.js',
      external: true,
    });
    expect(resolve('firebase/analytics')).toEqual({
      id: 'https://www.gstatic.com/firebasejs/1.2.3/firebase-analytics.js',
      external: true,
    });
  });

  it('defaults the version to the installed firebase package', () => {
    const { resolve } = resolver(firebaseFromCdn());
    expect(firebasePackage.version).toBe('12.19.0');
    expect(resolve('firebase/app')).toMatchObject({
      id: `https://www.gstatic.com/firebasejs/${firebasePackage.version}/firebase-app.js`,
    });
  });

  it('runs at build time only, before other resolvers', () => {
    const plugin = firebaseFromCdn();
    expect(plugin.name).toBe('firebase-from-cdn');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');
  });

  it.each([
    'firebase',
    '@firebase/app',
    'firebase/compat/app',
    'firebase/package.json',
    'react',
    './local',
  ])('leaves %s alone', (id) => {
    expect(resolver(firebaseFromCdn()).resolve(id)).toBeNull();
  });

  it('maps a disallowed module but warns once', () => {
    const { resolve, warn } = resolver(firebaseFromCdn({ version: '1.2.3' }));
    expect(resolve('firebase/app')).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    expect(resolve('firebase/database')).toEqual({
      id: 'https://www.gstatic.com/firebasejs/1.2.3/firebase-database.js',
      external: true,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('firebase/database');
  });

  it('honours a custom allow-list', () => {
    const { resolve, warn } = resolver(firebaseFromCdn({ allow: ['app'] }));
    resolve('firebase/analytics');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
