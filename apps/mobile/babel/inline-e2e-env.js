// Inlines the e2e build flags as literals at transform time (README "Cloud / e2e build"):
//   __E2E__            true when E2E_BUILD=1 (the e2e build: bundled JS that keeps the e2e hooks)
//   __E2E_API_URL__    E2E_API_URL, default http://localhost:4010 (the fixture API)
//   __E2E_BRIDGE_URL__ E2E_BRIDGE_URL, default ws://localhost:4011 (the e2e runner's bridge)
// Metro's cacheVersion (metro.config.js) is built from e2eEnv() so switching builds re-transforms.
// Jest runs without E2E_BUILD, so tests see __E2E__ === false and the defaults.

const DEFAULT_API_URL = 'http://localhost:4010';
const DEFAULT_BRIDGE_URL = 'ws://localhost:4011';

function e2eEnv(env = process.env) {
  return {
    __E2E__: env.E2E_BUILD === '1',
    __E2E_API_URL__: env.E2E_API_URL || DEFAULT_API_URL,
    __E2E_BRIDGE_URL__: env.E2E_BRIDGE_URL || DEFAULT_BRIDGE_URL,
  };
}

function inlineE2EEnv({ types: t }) {
  const values = e2eEnv();
  return {
    name: 'inline-e2e-env',
    visitor: {
      Identifier(path) {
        const name = path.node.name;
        if (!Object.prototype.hasOwnProperty.call(values, name)) return;
        // Only free references: not declarations, member properties, object keys or shadowed names.
        if (!path.isReferencedIdentifier() || path.scope.hasBinding(name, true)) return;
        const value = values[name];
        path.replaceWith(
          typeof value === 'boolean' ? t.booleanLiteral(value) : t.stringLiteral(value),
        );
      },
    },
  };
}

module.exports = inlineE2EEnv;
module.exports.e2eEnv = e2eEnv;
