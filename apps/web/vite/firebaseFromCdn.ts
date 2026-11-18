// Build-only rewrite of firebase/<x> imports to the gstatic CDN.
// Dev and tests run in serve mode, so they keep resolving the typed npm package.
import firebasePackage from 'firebase/package.json' with { type: 'json' };
import type { Plugin } from 'vite';

const FIREBASE_ID = /^firebase\/([a-z-]+)$/;
const DEFAULT_ALLOW = ['app', 'analytics'];

export function firebaseFromCdn(opts?: { version?: string; allow?: readonly string[] }): Plugin {
  const version = opts?.version ?? firebasePackage.version;
  const allow = opts?.allow ?? DEFAULT_ALLOW;
  return {
    name: 'firebase-from-cdn',
    apply: 'build',
    enforce: 'pre',
    resolveId(id) {
      const match = FIREBASE_ID.exec(id);
      if (!match) return null;
      const name = match[1]!;
      // Warn only: check-cdn.mjs is the gate, and it must get to run to name the module.
      if (!allow.includes(name)) {
        this.warn(`firebase/${name} is not in the CDN allow-list; check-cdn will fail the build`);
      }
      return {
        id: `https://www.gstatic.com/firebasejs/${version}/firebase-${name}.js`,
        external: true,
      };
    },
  };
}
