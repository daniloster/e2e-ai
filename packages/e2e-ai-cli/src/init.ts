// `e2e-ai init`: sets the tool up in any project — at a repo root ("global") or inside one app
// (`--project apps/web`). It writes the suite folder (config with the chosen integrations, docs
// skeletons, an example feature, a globals file, a routine, report templates, README, .gitignore),
// adds npm scripts to that project's package.json and recommends the VS Code extension.
// Planning is pure (planInit → file map) so it is tested without touching the disk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';

export const INTEGRATIONS = {
  web: { label: 'Web — Playwright (through @playwright/mcp, headless Chrome)', platform: 'web' },
  'web-playwright-test': { label: 'Web — Playwright Test runner (each scenario is a Playwright test)', platform: 'web' },
  'android-appium': { label: 'Android — Appium (UiAutomator2), black-box', platform: 'mobile' },
  'ios-appium': { label: 'iOS simulator — Appium (XCUITest), black-box', platform: 'mobile' },
  'android-maestro': { label: 'Android — Maestro CLI, black-box', platform: 'mobile' },
  'ios-maestro': { label: 'iOS simulator — Maestro CLI, black-box', platform: 'mobile' },
  mcp: { label: 'Any MCP server exposing the ui_* tools (your own driver)', platform: 'web' },
} as const;
export type Integration = keyof typeof INTEGRATIONS;

export interface InitOptions {
  /** Project folder that owns the suite (its package.json gets the scripts): "." or e.g. apps/web. */
  project: string;
  /** Suite folder inside the project. */
  dir: string;
  integrations: Integration[];
  webUrl: string;
  apiUrl: string;
  /** Mobile app id (bundle id / package) and URL scheme, for mobile integrations. */
  appId: string;
  scheme: string;
  /** Planning model, `name@endpoint` already split. */
  model: { name: string; endpoint: string };
  /** Also write a GitHub Actions workflow. */
  ci?: 'github';
  /** Also write each target's cloud variant (`<target>-saucelabs`, `<target>-browserstack`). */
  clouds?: ('saucelabs' | 'browserstack')[];
}

export const DEFAULTS: Omit<InitOptions, 'project' | 'dir' | 'integrations'> = {
  webUrl: 'http://localhost:3000',
  apiUrl: 'http://127.0.0.1:3000',
  appId: 'com.example.app',
  scheme: 'exampleapp',
  model: { name: 'qwen3-vl:4b-instruct-q4_K_M', endpoint: 'http://127.0.0.1:11434/v1' },
};

/** Models that passed the whole reference suite (see the repo README); used for `--benchmark`. */
export const RECOMMENDED_MODELS = ['qwen3-vl:4b-instruct-q4_K_M', 'qwen3:4b', 'qwen3.5:4b-q4_K_M'];

export function parseIntegrations(list: string): Integration[] {
  const out: Integration[] = [];
  for (const raw of list.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (!(raw in INTEGRATIONS)) throw new Error(`unknown integration "${raw}" (choose from ${Object.keys(INTEGRATIONS).join(', ')})`);
    if (!out.includes(raw as Integration)) out.push(raw as Integration);
  }
  if (out.length === 0) throw new Error('choose at least one integration');
  return out;
}

function target(i: Integration, o: InitOptions): [string, unknown] | undefined {
  const appium = (os: 'android' | 'ios') => ({
    platform: 'mobile',
    os,
    description: INTEGRATIONS[`${os}-appium`].label,
    driver: {
      type: 'appium',
      url: '${APPIUM_URL:-http://127.0.0.1:4723}',
      appId: o.appId,
      scheme: o.scheme,
      resetLink: 'e2e-reset',
      capabilities:
        os === 'android'
          ? { platformName: 'Android', 'appium:automationName': 'UiAutomator2', 'appium:appPackage': o.appId, 'appium:appActivity': `${o.appId}.MainActivity`, 'appium:noReset': true }
          : { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': '${IOS_SIMULATOR:-booted}', 'appium:bundleId': o.appId, 'appium:noReset': true, 'appium:autoDismissAlerts': true },
    },
  });
  const maestro = (os: 'android' | 'ios') => ({
    platform: 'mobile',
    os,
    description: INTEGRATIONS[`${os}-maestro`].label,
    driver: { type: 'maestro', device: os === 'android' ? '${ANDROID_SERIAL:-}' : '${IOS_SIMULATOR:-}', appId: o.appId, scheme: o.scheme, resetLink: 'e2e-reset' },
  });
  switch (i) {
    case 'web':
    case 'web-playwright-test': // Playwright Test uses the web target's baseUrl/startPath
      return [
        'web',
        {
          platform: 'web',
          description: INTEGRATIONS.web.label,
          driver: { type: 'playwright-mcp', baseUrl: '${APP_WEB_URL:-' + o.webUrl + '}', startPath: '/', command: 'npx', args: ['@playwright/mcp', '--browser', 'chrome', '--headless', '--isolated'] },
        },
      ];
    case 'android-appium':
      return ['android-appium', appium('android')];
    case 'ios-appium':
      return ['ios-appium', appium('ios')];
    case 'android-maestro':
      return ['android-maestro', maestro('android')];
    case 'ios-maestro':
      return ['ios-maestro', maestro('ios')];
    case 'mcp':
      return ['custom-mcp', { platform: 'web', description: INTEGRATIONS.mcp.label, driver: { type: 'mcp', command: 'node', args: ['path/to/your-mcp-server.js'] } }];
  }
}

const API_MD = `# API reference for the e2e tool

REST + JSON. Base URL: \`api.baseUrl\` in e2e-ai.config.json. Describe every endpoint the tests may
use to create data or sign in: one \`### METHOD /path\` heading, one sentence, a Field table.
GraphQL and gRPC: describe each operation the same way (heading = what the runner should call).

## Test data

### POST /test/reset

Deletes all test data. Runs before every scenario.

### POST /test/users

Creates a user account that can sign in.

| Field    | Type   | Required | Description       |
| -------- | ------ | -------- | ----------------- |
| email    | string | yes      | the email address |
| password | string | yes      | the password      |

## Authentication

### POST /auth/login

Signs a user in and returns a session token.

| Field    | Type   | Required | Description |
| -------- | ------ | -------- | ----------- |
| email    | string | yes      | email       |
| password | string | yes      | password    |

Response \`200\`: \`{ "token": "…" }\`
`;

const GUIDE_MD = `# App guide for the e2e tool

One paragraph: what the app does and for whom. The pocket model knows the app only from this file
and the API reference, so write the texts exactly as they appear on screen.

## Screens

- **Sign in**: title "Sign in", fields **Email** and **Password**, button **Sign in**. A wrong password
  shows "Wrong email or password.".
- Describe popups, sheets and banners too (consent, cookies, "What's new"): their title and buttons.
  \`@global\` rules can only react to what is described here.

## Routes

| Route  | Web     | Mobile | Description        |
| ------ | ------- | ------ | ------------------ |
| signin | /signin | signin | the sign in screen |

Mobile routes open as deep links (\`<scheme>://<route>\`). \`{token}\`-style placeholders are filled
from earlier API responses.

## Before every scenario

- POST /test/reset

## Glossary

- **signed in as X**: call POST /auth/login with X's email and password, then open a session route.

## Examples

- Given there is an account "bo@example.org" with password "hunter2" → call POST /test/users
- When I log in with "bo@example.org" and "hunter2" → fill Email field = "bo@example.org"; fill Password field = "hunter2"; tap Sign in button
- Then I should see "Welcome" → expect visible message = "Welcome"
`;

const FEATURE = `#auth #smoke
Feature: Signing in

  Background:
    @routine create user with login "ana@example.com" and password "s3cret!"

  Scenario: The right password signs in
    When I open the sign in screen
    And I log in with "ana@example.com" and "s3cret!"
    Then I should not see "Wrong email or password."

  Scenario: A wrong password is rejected
    When I open the sign in screen
    And I log in with "ana@example.com" and "nope"
    Then I should see "Wrong email or password."
`;

const GLOBALS = `# Standing rules: in force for every scenario. When the screen a rule talks about is visible, the
# runner carries the rule out, then continues. One rule per @global; a rule may span lines. Describe
# the screen (title and buttons) under "## Screens" in docs/app-guide.md.
#
# @global do not allow analytics when the app asks
# @global close the "What's new" sheet whenever it shows
`;

const ROUTINE = `Routine: create user with login "\${email}" and password "\${password}"

create a user "\${email}" with password "\${password}" via API
`;

function readme(o: InitOptions, run: string): string {
  const targets = o.integrations.map((i) => `- \`${i}\` — ${INTEGRATIONS[i].label}`).join('\n');
  return `# End-to-end tests (e2e-ai)

Tests are plain text: Gherkin \`.feature\` files, reusable \`.routine\` files and Markdown docs. A small
local model plans each step once; the plan is stored in \`.plans/plans.json\` (review it in PRs) and
replayed without a model in CI.

## Layout

| Path | What |
|---|---|
| \`e2e-ai.config.json\` | model endpoint, API URL, docs, targets (integrations), media, reports, benchmark |
| \`docs/api.md\` | the API the tests may call to create data and sign in |
| \`docs/app-guide.md\` | screens (exact visible texts), routes, "before every scenario", glossary, examples |
| \`features/*.feature\` | scenarios: Gherkin + \`#tags\` + \`@routine\` calls; several Backgrounds allowed |
| \`features/global.feature\` | \`@global\` standing rules (popups, consent…), applied whenever their screen shows |
| \`routines/*.routine\` | named groups of steps (data setup or UI flows), called with \`@routine\` |
| \`reports/templates/\` | report layouts; each is also the model's brief for the report text |
| \`reports/runs/\` | generated reports (git-ignored) |

## Targets set up

${targets}

${o.clouds?.length ? `Cloud variants (${o.clouds.join(', ')}): set ${o.clouds.map((c) => (c === 'saucelabs' ? '`SAUCE_USERNAME` / `SAUCE_ACCESS_KEY`' : '`BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY`')).join(' and ')}, point each mobile \`cloud.app\` at a test build that runs without a dev server and reaches your API through the tunnel, and install the tunnel binary (\`sc\` / \`BrowserStackLocal\`) or set \`tunnel\` to a running tunnel's name.\n\n` : ''}## Run

\`\`\`sh
${run} e2e:doctor        # checks docs, routines, the model endpoint and each driver
${run} e2e -- --target ${o.integrations.includes('web') || o.integrations.includes('web-playwright-test') ? 'web' : (target(o.integrations[0] as Integration, o)?.[0] ?? 'web')}
${run} e2e:replay -- --target <name>     # CI: reviewed plans only, no model
${run} e2e:benchmark -- --target <name>  # compare models: no-cache, cache, one-fresh
\`\`\`

The model is any OpenAI-compatible endpoint (\`model\` in the config; override with
\`--model '"name"@http://host:port/v1'\`). Locally: \`ollama pull ${o.model.name}\` — use GGUF tags; MLX
builds cannot produce JSON-schema output.

## Writing tests

1. Describe the API and screens in \`docs/\` (exact texts; every popup you want \`@global\` to handle).
2. Write scenarios in \`features/\`; quote exact values (\`"ana@example.com"\`) and visible texts.
3. Put repeated setup in \`routines/\` and call it with \`@routine …\` (the VS Code extension completes it).
4. Run, read \`reports/runs/<run>/index.html\`, review the plan diff, commit.
5. A step planned wrongly? Fix the docs (screens, glossary, examples), not the plan file.

Mobile targets need a debug build with the deep links \`${o.scheme}://e2e-reset\` (clean state) and one per
route in the app guide. Install the VS Code extension "E2E AI — Features & Routines" for colours,
routine completion and checks.
`;
}

/** Everything `init` writes, keyed by path relative to the project folder. */
export function planInit(o: InitOptions): { files: Map<string, string>; scripts: Record<string, string> } {
  const d = (p: string) => posix.join(o.dir.split('\\').join('/'), p);
  const local = o.integrations.map((i) => target(i, o)).filter((t): t is [string, unknown] => !!t);
  const cloudVariants = (o.clouds ?? []).flatMap((provider) =>
    local
      .filter(([name]) => name !== 'custom-mcp')
      .map(([name, t]): [string, unknown] => {
        const tt = t as { platform: string; description?: string };
        const cloud =
          tt.platform === 'mobile'
            ? { provider, app: '<path to your test build: .apk / .ipa / zipped .app>', device: provider === 'saucelabs' ? 'Google Pixel.*' : 'Google Pixel 8', platformVersion: '14.0', tunnel: true, build: '${E2E_BUILD_NAME:-local}' }
            : { provider, browser: 'chrome', tunnel: true, build: '${E2E_BUILD_NAME:-local}' };
        return [`${name}-${provider}`, { ...tt, description: `${tt.description ?? name} — on ${provider}`, cloud }];
      }),
  );
  const targets = Object.fromEntries([...local, ...cloudVariants]);
  const config = {
    model: { provider: 'openai', endpoint: '${E2E_MODEL_ENDPOINT:-' + o.model.endpoint + '}', name: '${E2E_MODEL:-' + o.model.name + '}' },
    docs: { api: ['docs/api.md'], guide: 'docs/app-guide.md' },
    api: { baseUrl: '${APP_API_URL:-' + o.apiUrl + '}' },
    features: 'features',
    routines: 'routines',
    plans: '.plans/plans.json',
    reports: { templates: 'reports/templates', runs: 'reports/runs', defaultTemplate: 'engineering' },
    media: { screenshots: 'steps', video: 'all', stepPauseMs: 600 },
    targets,
    benchmark: {
      models: RECOMMENDED_MODELS.map((m) => `"${m}"@\${E2E_MODEL_ENDPOINT:-${o.model.endpoint}}`),
      modes: ['no-cache', 'cache', 'one-fresh'],
    },
  };
  const cfgArg = `--config ${d('e2e-ai.config.json')}`;
  const files = new Map<string, string>([
    [d('e2e-ai.config.json'), `${JSON.stringify(config, null, 2)}\n`],
    [d('docs/api.md'), API_MD],
    [d('docs/app-guide.md'), GUIDE_MD],
    [d('features/sign_in.feature'), FEATURE],
    [d('features/global.feature'), GLOBALS],
    [d('routines/create_user.routine'), ROUTINE],
    [d('README.md'), readme(o, 'npm run')],
    [d('.gitignore'), 'reports/runs/\n.playwright-mcp/\nplaywright/test-results/\nplaywright/report/\n'],
    ['.vscode/extensions.json', `${JSON.stringify({ recommendations: ['pocketnotes.e2e-ai-vscode'] }, null, 2)}\n`],
  ]);
  if (o.ci === 'github') {
    files.set(
      '.github/workflows/e2e.yml',
      `name: e2e
on: [pull_request]
jobs:
  e2e:
    runs-on: ubuntu-latest
    strategy:
      matrix: { shard: [1, 2] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npx playwright install --with-deps chrome
      # Start the app and its test API here (they must answer on the URLs in ${d('e2e-ai.config.json')}).
      - run: npx e2e-ai run ${cfgArg} --target ${Object.keys(targets)[0] ?? 'web'} --replay --shard \${{ matrix.shard }}/2 --junit ${d('reports/junit-${{ matrix.shard }}.xml')}
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: e2e-report-\${{ matrix.shard }}, path: ${d('reports/runs')} }
`,
    );
  }
  const scripts: Record<string, string> = {
    e2e: `e2e-ai run ${cfgArg}`,
    'e2e:replay': `e2e-ai run ${cfgArg} --replay`,
    'e2e:benchmark': `e2e-ai run ${cfgArg} --benchmark`,
    'e2e:doctor': `e2e-ai doctor ${cfgArg}`,
    'e2e:report': `e2e-ai report`,
  };
  if (o.integrations.includes('web-playwright-test')) scripts['e2e:playwright'] = `playwright test -c ${d('playwright')}`;
  return { files, scripts };
}

/** Writes the plan into `root/project`; existing files are kept unless `force`. */
export function applyInit(root: string, o: InitOptions, plan: ReturnType<typeof planInit>, force = false, log = (l: string) => console.log(l)): void {
  const base = resolve(root, o.project);
  for (const [rel, content] of plan.files) {
    const path = join(base, rel);
    const shown = relative(root, path);
    if (existsSync(path) && !force) {
      log(`exists ${shown}`);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
    log(`wrote  ${shown}`);
  }
  const pkgPath = join(base, 'package.json');
  const existed = existsSync(pkgPath);
  const pkg: { scripts?: Record<string, string> } & Record<string, unknown> = existed
    ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> })
    : { name: base.split(/[\\/]/).pop() ?? 'e2e', private: true };
  const scripts: Record<string, string> = (pkg.scripts ??= {});
  const added: string[] = [];
  for (const [k, v] of Object.entries(plan.scripts)) {
    if (scripts[k] && !force) continue;
    scripts[k] = v;
    added.push(k);
  }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  log(`${existed ? 'updated' : 'wrote  '} ${relative(root, pkgPath)}${added.length ? ` (scripts: ${added.join(', ')})` : ''}`);
}
