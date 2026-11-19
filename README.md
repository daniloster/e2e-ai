# e2e-ai

Plain-language end-to-end tests for web and mobile apps, planned by a **small open model that fits on
a phone** and executed through the tool you already use (Playwright, Appium, Maestro or any MCP
server).

- Test authors write **only** Gherkin `.feature` files, reusable `.routine` files, `@global` rules,
  Markdown docs of the API and screens, and one JSON config — never TypeScript.
- The model plans each step **once**; plans are stored in a lockfile (`.plans/plans.json`) that is
  reviewed in PRs and **replayed in CI without any model**.
- The model never decides whether a test passed: assertions are deterministic checks on what the
  driver returns, and everything the model may call or open comes from the docs as JSON-schema enums.

| Package | What |
|---|---|
| [`packages/e2e-ai`](packages/e2e-ai/README.md) | the engine library: parsing, planning, guards, grounding, integrations, reports, benchmarks |
| [`packages/e2e-ai-cli`](packages/e2e-ai-cli/README.md) | the `e2e-ai` command: init, doctor, run, replay, benchmark, report, Playwright Test |
| [`packages/vscode-e2e-ai`](packages/vscode-e2e-ai/README.md) | VS Code extension: colours, routine completion, `@global` support, diagnostics, outline |

Guides: [authoring guide (`e2e/README.md`)](e2e/README.md) · [for AI agents (`AGENTS.md`)](AGENTS.md) ·
[architecture](ARCHITECTURE.md) · [investigation and measurements](docs/20261118-e2e-ai-cucumber-small-models/).

---

## Quick start

```sh
# 1. a local model (any OpenAI-compatible endpoint works; use GGUF tags — MLX builds cannot do JSON-schema output)
ollama pull qwen3-vl:4b-instruct-q4_K_M

# 2. set up a suite — at the repo root or inside one app (apps/web, apps/mobile, …)
npx e2e-ai init                                   # interactive
npx e2e-ai init --yes --project apps/web --integrations web,web-playwright-test --web-url http://localhost:5173

# 3. describe your API and screens in <suite>/docs/, write features, then
npm run e2e:doctor                                # docs, routines, model endpoint, drivers
npm run e2e -- --target web                       # plan new steps + run + HTML report
npm run e2e:replay -- --target web                # CI: reviewed plans only, no model
```

`init` writes: `e2e-ai.config.json` (model, API URL, the chosen integrations as targets, media,
reports, benchmark models), `docs/api.md` and `docs/app-guide.md` skeletons, an example feature,
`features/global.feature`, a routine, report templates, a README and `.gitignore`, npm scripts in
that project's `package.json`, a VS Code recommendation, and optionally a GitHub Actions workflow
(`--ci github`). Existing files are kept unless `--force`.

## Writing tests

```gherkin
#notes #team-atlas
Feature: Notes

  Background:
    @routine create user "bo@example.com" with password "pw" and notes:
      | title | description |
      | Milk  | 2 litres    |

  Scenario: Deleting a note
    Given I am signed in as "bo@example.com"
    When I delete the note "Milk"
    Then I should see "No notes yet. Add your first one."
```

| File | Purpose |
|---|---|
| `docs/*.md` (API) | `### METHOD /path` + a Field table per endpoint the tests may call (REST; GraphQL/gRPC operations the same way) |
| `docs/app-guide.md` | `## Screens` (exact visible texts), `## Routes` (web paths + mobile deep links), `## Before every scenario`, `## Glossary`, `## Examples` (the biggest accuracy lever) |
| `features/*.feature` | Gherkin with `#tags`, `@routine` calls and several Backgrounds (each applies to the scenarios below it, until the next) |
| `routines/*.routine` | `Routine: <signature with ${params} and ${table:name[cols]}>` + plain steps, nested calls, `each` loops |
| `features/global.feature` | `@global <rule>` standing rules — e.g. `@global do not allow firebase user analytics`. Planned once into *when these texts are on screen* → *tap/fill*; checked on every screen read for every scenario |

Modals, bottom sheets, alerts and OS permission prompts are read as `dialog`/`alert` elements named
by their title on every platform, so steps and `@global` rules can act on them
(`@global allow notifications when asked`); custom components get roles in the config
(`"ui": { "roles": { "android": { "com.acme.PrimaryButton": "button" } } }`) — see
[§5c](e2e/README.md).

Full reference: [`e2e/README.md`](e2e/README.md).

## CLI

| Command | |
|---|---|
| `e2e-ai init` | set up a suite anywhere (`--project`, `--dir`, `--integrations`, `--web-url`, `--api-url`, `--app-id`, `--scheme`, `--model`, `--ci github`, `--yes`, `--force`) |
| `e2e-ai doctor` | checks docs, routines, the model's JSON-schema output and every driver |
| `e2e-ai run` | `--target`, `--model '"name"@http://host:port/v1'`, `--replay`, `--no-cache`, `--tags "#smoke,!#slow"`, `--shard i/n`, `--max-failures N`, `--junit file`, `--template a,b`, `--screenshots`, `--video` |
| `e2e-ai run --benchmark ['"a"@url;"b"@url']` | compares models in modes `no-cache`, `cache`, `one-fresh`; `--memory-docker`, `--environment` |
| `e2e-ai report <run>` | re-renders a run with other templates |
| `e2e-ai playwright init` | generates a Playwright Test project that runs the features |

Exit codes: `0` all passed, `1` a scenario failed, `2` configuration error. Reports (HTML with step
screenshots, per-scenario video with per-step clip playback, JSON, JUnit) land in `reports/runs/<run>/`.

## VS Code extension

Colours for `.feature`, `.routine` and `@global`; `@` completion inserting routines as snippets with
table skeletons; `#tag` and `${param}` completion; hover, go-to-definition, find-references and usage
CodeLens for routines; outline; diagnostics computed with the runner's own parsers (unknown routine
calls, missing tables, duplicate routines, empty/duplicate/misplaced `@global`).
Build: `npm run package -w e2e-ai-vscode`, then `code --install-extension packages/vscode-e2e-ai/dist/e2e-ai-vscode-0.1.0.vsix`.

## Library

```ts
import { loadConfig, contextFromDocs, createLlm, createDriver, openPlanCache, parseFeature, runScenario } from '@pn/e2e-ai';
import { defineFeatureTests } from '@pn/e2e-ai/playwright'; // every scenario as a Playwright test
```

Teams normally never import it: the CLI and `e2e-ai playwright init` cover running. The library is
for building other integrations (a new driver only has to return the screen as `UiElement[]` and
implement `tap`, `fill`, `openRoute`).

## Integrations

| `driver.type` | Platform | Validated here |
|---|---|---|
| `playwright-mcp` (Microsoft `@playwright/mcp`, Chrome) | web | ✅ benchmark below |
| Playwright Test (`e2e-ai playwright init`) | web | ✅ 11/11 |
| `mcp` (any MCP server exposing `ui_*` tools; bundled `web-mcp`, `rn-mcp`) | web, iOS, Android | ✅ web, iOS |
| `appium` (W3C WebDriver: UiAutomator2 / XCUITest) | Android, iOS | ✅ Android (benchmark below), iOS 11/11 |
| any of the above on Sauce Labs / BrowserStack | via `cloud` | see below |
| `rn-bridge` (in-app debug bridge, gray-box) | iOS, Android | ✅ iOS |
| `maestro` (Maestro CLI) | Android, iOS | ⚠️ implemented and unit-tested, not run on a device |

**Sauce Labs and BrowserStack:** any target can run on either cloud by adding a `cloud` block
(credentials from `SAUCE_*` / `BROWSERSTACK_*` environment variables; the app build is uploaded; a
tunnel — Sauce Connect / BrowserStack Local — is opened for the run; the vendor session is linked
from the report and marked passed/failed):

| Integration | On Sauce Labs / BrowserStack | Checked here |
|---|---|---|
| `appium` | the vendor's Appium hub | ✅ 11/11 on each, through local stand-ins of both vendors (`npm run e2e:cloud:check`) |
| `rn-bridge` (our native driver) | the vendor's Appium hosts the app, our in-app bridge drives it | ✅ 11/11 (stand-in) |
| `mcp` web (our Playwright driver), Playwright Test | BrowserStack: remote Playwright; Sauce: Playwright via Selenium Grid | ✅ 11/11 each (Playwright run-server; a Grid-style hub) |
| `playwright-mcp` | BrowserStack: `browser.remoteEndpoint`; Sauce: Selenium Grid variables | ✅ 11/11 each (stand-ins) |
| `maestro` | each scenario compiled into one Maestro flow from the reviewed plans, run by maestro-runner on the vendor hub (or BrowserStack's Maestro API) | ⚠️ flows compiled for all 11 scenarios; not executed (maestro-runner not installable here) |

None of this has run against the real vendors yet (no accounts in this environment): set the
credentials and run e.g. `npx e2e-ai run --target android-appium-browserstack`. Details:
[e2e/README.md §5b](e2e/README.md).

---

## Findings and benchmark

**Machine:** a GitHub-CI-sized Linux container — 4 vCPU / 16 GB, **CPU only** (Ollama 0.40.2 in Docker,
colima VM on Apple Silicon). Suite: 3 features, 11 scenarios, 59 steps, plus one `@global` rule.
Every model starts from an **empty plan cache** and plans every step itself from the docs.
Modes: **no-cache** = every step planned · **cache** = the plans just recorded, replayed · **one-fresh** =
cached, except the largest scenario ("Several notes from a table", 7 steps) planned again (a PR that
changes one scenario).

### Web — Playwright (`@playwright/mcp`, headless Chrome)

| Model | Size | Mode | Passed | Total time | Planned step mean / median | Cached step mean / median | Peak memory (model / container) |
|---|---|---|---|---|---|---|---|
| **qwen3-vl:4b-instruct** ★ | 3.34 GB | no-cache | 11/11 | 225 s | 3390 / 2858 ms | — | 3.87 / 5.04 GB |
| | | cache | 11/11 | 13 s | — | 125 / 3 ms | 3.87 / 4.80 GB |
| | | one-fresh | 11/11 | 41 s | 3960 / 3827 ms | 141 / 3 ms | 3.87 / 5.00 GB |
| qwen3:4b | 2.50 GB | no-cache | 11/11 | 267 s | 4004 / 3693 ms | — | 3.50 / 4.17 GB |
| | | cache | 11/11 | 13 s | — | 125 / 2 ms | 3.50 / 3.92 GB |
| | | one-fresh | 11/11 | 45 s | 4528 / 4556 ms | 141 / 3 ms | 3.50 / 4.13 GB |
| qwen3.5:4b | 3.32 GB | no-cache | 11/11 | 407 s | 6471 / 6127 ms | — | 3.66 / 6.58 GB |
| | | cache | 11/11 | 14 s | — | 135 / 3 ms | 3.66 / 5.85 GB |
| | | one-fresh | 11/11 | 68 s | 7743 / 7070 ms | 152 / 3 ms | 3.66 / 5.89 GB |

### Android — Appium (UiAutomator2), Android 15 emulator

| Model | Size | Mode | Passed | Total time | Planned step mean / median | Cached step mean / median | Peak memory (model / container) |
|---|---|---|---|---|---|---|---|
| **qwen3-vl:4b-instruct** ★ | 3.34 GB | no-cache | 11/11 | 281 s | 3447 / 2938 ms | — | 3.87 / 5.04 GB |
| | | cache | 11/11 | 79 s | — | 364 / 22 ms | 3.87 / 4.80 GB |
| | | one-fresh | 11/11 | 105 s | 3934 / 3775 ms | 384 / 23 ms | 3.87 / 5.00 GB |
| qwen3:4b | 2.50 GB | no-cache | 11/11 | 310 s | 3943 / 3394 ms | — | 3.50 / 4.16 GB |
| | | cache | 11/11 | 79 s | — | 351 / 22 ms | 3.50 / 3.94 GB |
| | | one-fresh | 11/11 | 113 s | 4748 / 4795 ms | 390 / 24 ms | 3.50 / 4.15 GB |
| qwen3.5:4b | 3.32 GB | no-cache | 11/11 | 469 s | 6628 / 6422 ms | — | 3.66 / 6.34 GB |
| | | cache | 11/11 | 78 s | — | 348 / 22 ms | 3.66 / 5.82 GB |
| | | one-fresh | 11/11 | 134 s | 7972 / 7090 ms | 387 / 23 ms | 3.66 / 5.87 GB |

★ recommended: all pass; fewest guard repairs (3, vs 6 for qwen3:4b); fastest planner. Each model
also planned the `@global` rule (≈ 19 s, once per run) as *when "Help us improve Pocket Notes" → tap
No thanks*; on Android it dismissed the consent sheet of the freshly cleared app.

The full reports (comparison pages, every model's run with step screenshots) are archived in
[`e2e/reports/examples/`](e2e/reports/examples/).

**What the numbers say**

- All three fit a standard CI runner with room to spare (≤ 6.6 GB container peak in 16 GB).
- Planning dominates a first run (3–7 s per step on CPU); **replaying reviewed plans needs no model** —
  13 s for the whole web suite. The Android replay (79 s) is device time: app relaunch, waiting for
  the screen to settle, Appium round-trips.
- A PR that changes one scenario adds ~30 s (web) for the re-plan with the recommended model.
- Mean cached step times are pulled up by a few slow UI steps; the median (2–3 ms web, 22 ms Android)
  is the typical step.
- iOS was not benchmarked: a Linux CI machine cannot run iOS simulators. iOS passes 11/11 on macOS
  through the RN bridge and Appium (XCUITest).

### Other models tested (for awareness)

The tool was exercised with a broad range of small open models; these did **not** pass:

| Model | Size | Result | Why |
|---|---|---|---|
| gemma4:e2b-it | 4.59 GB | 8/11 scenarios | duplicated a setup call; two assertions failed |
| qwen3-vl:2b-instruct | 1.93 GB | 2/11 scenarios | created the same user twice in setup |
| Holo2-4B (GUI-grounding specialist, community GGUF) | 3.17 GB | 2/11 scenarios | not a planner; answers cut off by the output cap |
| LFM2.5-VL-3B (GUI-grounding specialist) | 2.26 GB | 1/11 scenarios | wrong elements; missing login before an authenticated call |
| qwen3:1.7b | 1.36 GB | 10/10 on the first, smaller suite | needs worked examples (61 % zero-shot step accuracy); not in the final suite |
| llama3.2:3b | 2.02 GB | 75 % step accuracy (labelled steps) | below the bar for planning |
| qwen3:0.6b | 0.52 GB | 71 % step accuracy | below the bar |
| smollm2:1.7b | 1.82 GB | 61 % step accuracy | below the bar |
| llama3.2:1b | 1.32 GB | 54 % step accuracy | below the bar |
| gemma3:1b | 0.81 GB | 25 % step accuracy | below the bar |
| lfm2.5-1.2b-instruct | 0.73 GB | 0 % step accuracy | no usable structured output |

Lessons: worked examples in the app guide matter more than model size below 4 B; GUI-grounding
specialists are not planners; Ollama's MLX builds (default tags on Apple Silicon for some models)
cannot produce JSON-schema output — use GGUF tags. Details in the
[investigation](docs/20261118-e2e-ai-cucumber-small-models/).

---

## This repository

| Path | What |
|---|---|
| `packages/` | the product (engine, CLI, VS Code extension) |
| `e2e/` | the example suite the benchmarks ran: config, docs, features, routines, `@global` rules, templates |
| `apps/web`, `apps/mobile` | Pocket Notes, a small demo app (web + React Native) used as the test target |
| `apps-modules/` | the demo apps' modules: `core`, `design-tokens`, `i18n`, `fixture-api` (in-memory test API on :4010) |
| `tools/brand` | demo-app icon and splash generator |
| `docs/` | the investigation: options, measurements, decisions, failure modes |

```sh
nvm use && npm install && npm install --prefix apps/mobile
npm run lint && npm run typecheck && npm test
npm run api & npm run notes:web &                 # fixture API :4010, web app :5180/app.html
npx e2e-ai run --target web-playwright-mcp        # or android-appium, ios, ios-appium, …
```
