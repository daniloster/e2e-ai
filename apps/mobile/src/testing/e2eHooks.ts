// The e2e hooks (in-app bridge, e2e deep links, e2e reset) are on in debug builds and in the e2e
// build (E2E_BUILD=1: bundled JS for device clouds, README "Cloud / e2e build"); off in release.
export const E2E_HOOKS: boolean = __DEV__ || __E2E__;
