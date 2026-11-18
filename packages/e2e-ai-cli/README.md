# e2e-ai (CLI) — `@pn/e2e-ai-cli`

The command teams, CI and AI agents use. It reads `e2e/e2e-ai.config.json`, the Markdown docs, the
`.feature` and `.routine` files, plans steps with the configured model, drives the target through its
integration, and writes reports. Authoring guide: [`e2e/README.md`](../../e2e/README.md).

## Commands

| Command | Does |
|---|---|
| `e2e-ai init` | set up a suite in any project (see below) |
| `e2e-ai doctor [--target t]` | parse docs and routines, call the model once (JSON-schema output), start each driver |
| `e2e-ai run [options] [features…]` | run scenarios; plans new steps with the model, reuses reviewed plans |
| `e2e-ai run --benchmark [models]` | compare models (see below) |
| `e2e-ai report <run dir \| report.json> [--template a,b]` | re-render a run's reports |
| `e2e-ai playwright init` | generate `e2e/playwright/` so `npx playwright test -c e2e/playwright` runs the features |
| `e2e-ai --help` | everything below |

## Setup (`e2e-ai init`)

Asks (or takes flags) and writes a ready-to-edit suite: `e2e-ai.config.json` with the chosen
integrations and the recommended benchmark models, `docs/api.md` + `docs/app-guide.md` skeletons, an
example feature, `features/global.feature`, a routine, the report templates, a README and `.gitignore`;
adds `e2e`, `e2e:replay`, `e2e:benchmark`, `e2e:doctor`, `e2e:report` scripts to that project's
`package.json` (created if missing) and recommends the VS Code extension in `.vscode/extensions.json`.

```sh
npx e2e-ai init                                                    # interactive
npx e2e-ai init --yes                                              # repo root, web only
npx e2e-ai init --project apps/web --integrations web,web-playwright-test --web-url http://localhost:5173
npx e2e-ai init --project apps/mobile --integrations android-appium,ios-appium --app-id com.shop.dev --scheme shop --ci github
```

Integrations: `web` (Playwright via @playwright/mcp), `web-playwright-test` (Playwright Test runner),
`android-appium`, `ios-appium`, `android-maestro`, `ios-maestro`, `mcp` (your own MCP server).
Existing files and scripts are kept unless `--force`.

## Run options

| Option | Effect |
|---|---|
| `--config <file>` | default `e2e/e2e-ai.config.json` |
| `--target <name>` | a `targets` entry: web, web-playwright-mcp, ios, android, ios-appium, android-appium, ios-maestro, android-maestro, … |
| `--model '"name"@http://host:port/v1'` | override the planning model (endpoint optional) |
| `--replay` | CI mode: only reviewed plans, no model; a step without a plan fails |
| `--no-cache` | plan every step every time; the plans file is neither read nor written |
| `--tags "#smoke,!#slow"` | any of / none of |
| `--shard i/n` | the i-th of n slices of the suite (parallel CI jobs) |
| `--max-failures N` | stop after N failed scenarios |
| `--junit <file>` | JUnit XML |
| `--template a,b` | report templates (first → `index.html`) |
| `--no-ai-report` | layout and texts generated without the model |
| `--screenshots steps\|failures\|none`, `--video all\|mobile\|none` | media |

Exit codes: `0` all passed · `1` a scenario failed · `2` configuration or usage error.

## Benchmark

```sh
e2e-ai run --target web --benchmark '"qwen3-vl:4b-instruct-q4_K_M"@http://127.0.0.1:11434/v1;"qwen3:4b"@http://127.0.0.1:11434/v1'
e2e-ai run --target web --benchmark            # models from config benchmark.models
```

Modes per model (`--modes`, default `no-cache,cache,one-fresh`; `--fresh-scenario "<name>"`), memory
sampling (`--memory-docker <container>[@context]`), machine label (`--environment "…"`). Output:
`reports/runs/<slug>-benchmark/index.html` with each model's run reports under `models/<name>/<mode>/`.

## CI recipe

```yaml
- run: npx e2e-ai run --target web --replay --shard ${{ matrix.shard }}/4 --junit reports/junit-${{ matrix.shard }}.xml
```

Plans are made on a developer machine (`e2e-ai run`), reviewed in the PR (`e2e/.plans/plans.json`),
and replayed in CI without a model. A PR that adds a scenario can plan only that scenario in CI with a
model service, or fail fast on the missing plan with `--replay`.
