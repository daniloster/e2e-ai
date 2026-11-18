# Writing E2E tests with e2e-ai — guide for people and AI agents

You write **plain-language files only**. A small open model (the *pocket model*) reads them, plans
each step, and drives the web and mobile apps through an integration (Playwright, Appium, Maestro or
any MCP server). Nothing here is code.

Start a new suite in any project with `npx e2e-ai init` (it asks where — the repo root or an app
folder such as `apps/web` — and which integrations; or pass `--project`, `--integrations`, `--yes`).

```
e2e/
  e2e-ai.config.json        ← model endpoint, docs, API URL, targets (MCP drivers), media, reports
  docs/
    <api>.md                ← API reference: how to create data and get a session   (REQUIRED)
    app-guide.md            ← screens, routes, glossary, examples                    (REQUIRED)
  features/*.feature        ← behaviour in Gherkin (+ #tags, @routine, several Backgrounds)
  features/global.feature   ← @global standing rules (popups, consent…), applied whenever they match
  routines/*.routine        ← reusable step groups (data setup or UI flows)
  reports/templates/*.html  ← report layouts (each is also the model's brief)
  reports/templates/benchmark/*.html ← model-comparison layouts
  reports/runs/             ← generated: one folder per run (git-ignored)
  .plans/plans.json         ← generated: reviewed plans (commit it; review its diffs)
```

The model can **only** call endpoints and open routes that the docs declare, and it **never**
decides whether a test passed: assertions are deterministic checks on what the driver returns.
So the quality of your docs sets the ceiling of the tests.

---

## 1. The API reference (`docs/<anything>.md`) — required

Every endpoint the tests may use, especially the ones that **create data** and the one that
**returns a session**. One file or several (list them in `docs.api` in the config).

### Format (parsed — keep it exactly like this)

````markdown
### POST /__test/users

Creates a user account that can sign in.            ← one sentence: WHAT it does, WHEN to use it

| Field    | Type   | Required | Description                     |
| -------- | ------ | -------- | ------------------------------- |
| email    | string | yes      | the email address               |
| password | string | yes      | the password                    |
| name     | string | no       | display name                    |

Response `201`: `{ "id": "u1", "email": "ana@example.com" }`   ← show fields later steps need
````

- Heading: `### METHOD /path` (`GET POST PUT PATCH DELETE`). Path parameters as `{id}` (also a row
  in the table, "(path)" in its description).
- Table header must contain **Field**, **Type** (`string` / `number` / `boolean`), **Required**
  (`yes` / `no`) and **Description**. GET/DELETE fields become the query string; others the JSON body.
- `**Auth: bearer**` anywhere under the heading = the call needs the token from the login endpoint
  (the tool attaches it automatically from the latest `token` an API call returned).
- Show the **response shape** whenever a later step needs a value from it (e.g. `token`, `id`).
- GraphQL: `### MUTATION createNote` / `### QUERY notes`; gRPC: `### RPC pkg.Service/Method`, each
  with the same Field table. They are parsed and offered to the model; **only REST executes today**.

### What to include (checklist)

- [ ] A **reset** endpoint (wipes test data) — listed under "Before every scenario" in the guide.
- [ ] One **create** endpoint per kind of data a feature may need (user, note, order…), with every
      field a scenario could mention (title, description, done…).
- [ ] The **login** endpoint and what it returns (the token field name).
- [ ] Endpoints the app uses that a step might reference ("via API" steps).
- [ ] One sentence per endpoint that says **when to use it** ("Use for Given … exists").
- [ ] Mark test-only endpoints clearly (a `## Test data` section) so nobody ships them.

---

## 2. The app guide (`docs/app-guide.md`) — required

Sections are found by their `##` headings. Only these four are parsed; anything else (like
`## Screens`) is given to the model as context.

### `## Screens` (context)
What each screen shows, using the **exact visible labels** (button texts, field labels, headings,
empty/error messages). The model grounds "the Add note button" against the real UI using these words.

### `## Routes` (parsed table)

```markdown
| Route         | Web                               | Mobile                | Description                          |
| ------------- | --------------------------------- | --------------------- | ------------------------------------ |
| signin        | /app.html#/signin                 | signin                | the sign in screen                   |
| notes-session | /app.html?session={token}#/notes  | notes?session={token} | the notes, already signed in         |
```

- Route names are what the model may `open`. Web = path on the web base URL; Mobile = deep-link
  route the app's e2e bridge understands (`route?param=value`).
- `{token}` (or any `{name}`) is filled from the latest API response field of that name — this is
  how "Given I am signed in as X" works without a UI login.

### `## Before every scenario` (parsed list)
```markdown
- POST /__test/reset
```

### `## Glossary` (parsed list)
Domain words → what they mean **as actions or UI**. One line each: `- **term**: meaning`.
Most valuable: how to reach a state ("signed in as X: call POST /auth/login, then open
notes-session"), what a domain object looks like on screen ("a note: a row with its title").

### `## Examples` (parsed list) — the single biggest accuracy lever
One example per *pattern* of step, phrased differently from your features:

```markdown
- Given there is an account "bo@example.org" with password "hunter2" → call POST /__test/users
- Given I am signed in as "bo@example.org" → call POST /auth/login; open notes-session
- When I log in with "bo@example.org" and "hunter2" → fill Email field = "bo@example.org"; fill Password field = "hunter2"; tap Sign in button
- When I remove the note "Water plants" → tap Delete button of note = "Water plants"
- Then there should be 3 notes → expect count notes in the list = 3
- Then I should not see "Water plants" → expect hidden note = "Water plants"
```

Action words: `call METHOD /path` · `open <route>` · `fill <field> = "value"` · `tap <element> [= "row text"]` ·
`expect visible <what> = "text"` · `expect hidden <what> = "text"` · `expect count <what> = N`;
separate actions with `;`. Measured effect in the spike (qwen3:1.7b): 93 % exact plans with examples, 43 % without.

---

## 3. Features (`features/*.feature`)

Standard Gherkin, plus:

- **Tags** with a hash on their own line: `#notes #team-atlas` (a comment is `# text`, with a space).
  Filter runs with `--tags "#smoke,!#slow"`.
- **Routine calls**: a line `@routine <call text>` (optionally after a step keyword), with a data
  table below when the routine takes one.
- **Several `Background:` blocks**: each applies only to the scenarios **below it**, until the next
  `Background:` (see `features/seeding.feature`: Background 1 → scenario 1; Background 2 → scenarios 2–3).
  Reports label these steps **BACKGROUND**.
- Quote exact values and visible texts: `I add a note "Buy milk"`, `I should see "My notes"`.
  Quotes are identity: the tool only taps an element that shows the quoted text.
- `Given` = setup (API calls, opening screens); `When` = UI actions; `Then` = checks only
  (enforced by the model's grammar).
- `#skip-web` / `#skip-ios` skip a scenario on a target.

## 4. Routines (`routines/*.routine`)

```
Routine: create user "${email}" with password "${password}" and notes: ${table:notes[title, description]}

@routine create user with login "${email}" and password "${password}"
@routine user "${email}" has notes: ${table:notes[title, description]}
```

- `Routine:` + a signature; `${name}` = value parameter, `${table:name[col, col]}` = the caller's table.
- Body lines: plain-language steps (planned like feature steps), `@routine` calls (pass a table on
  with `${table:name[...]}`), `each ${table:name}` + indented lines (or the next line) per row,
  where `${column}` is the row value. Several `Routine:` blocks per file are fine.
- Calls are matched to signatures exactly (quotes become parameters); a call no signature matches
  is matched by the model, and every bound value must appear in the call.
- "…via API" in a body line tells the model to use the API endpoints, not the screens.

## 4b. Global rules (`features/global.feature`)

```
@global do not allow firebase user analytics
@global when the "What's new" sheet shows,
        close it
```

- A **globals file** is any `.feature` whose first content line starts with `@global` (name it
  `global.feature` by convention). Each rule runs from its `@global` to the next `@global` or the end
  of the file; lines are joined; blank and `#` lines are ignored. `@global` inside a normal feature is
  ignored by the runner (the VS Code extension warns).
- Rules are **in force for every scenario of the run**, whichever features you run.
- The model plans each rule **once** (stored in `.plans/plans.json` like a step): *when* — 1–3 texts
  that are on screen exactly when the rule applies, which **must appear in the app guide** (or the rule)
  or they are dropped — and *do* — taps/fills only (a rule never calls APIs, navigates or asserts).
- At run time every screen read checks the rules deterministically (all *when* texts visible); a
  matching rule acts, the screen is read again, and the step continues. Each firing is shown under the
  step in the report and the log (`↺ @global …`). A rule fires at most 5 times per scenario.
- So: describe the popup in `## Screens` (title + buttons). `--replay` with an unplanned rule fails
  the scenario up front instead of silently ignoring the rule.

## 5. The config (`e2e-ai.config.json`)

```json
{
  "model": { "provider": "openai", "endpoint": "http://127.0.0.1:11434/v1", "name": "qwen3:4b" },
  "docs": { "api": ["docs/notes-api.md"], "guide": "docs/app-guide.md" },
  "api": { "baseUrl": "http://127.0.0.1:4010" },
  "targets": {
    "web": { "platform": "web", "mcp": { "command": "node", "args": ["packages/e2e-ai/src/mcp/web-mcp.ts", "--base-url", "http://localhost:5180", "--start", "/app.html"], "cwd": ".." } },
    "ios": { "platform": "mobile", "mcp": { "command": "node", "args": ["packages/e2e-ai/src/mcp/rn-mcp.ts", "--launch", "xcrun simctl launch ${PN_SIM:-booted} com.app.dev", "--sim", "${PN_SIM:-booted}"], "cwd": ".." } }
  },
  "media": { "screenshots": "steps", "video": "mobile" },
  "reports": { "templates": "reports/templates", "runs": "reports/runs", "defaultTemplate": "engineering" }
}
```

- `model.endpoint`: any OpenAI-compatible server (llama.cpp `llama-server`, Ollama `/v1`, vLLM,
  LM Studio). `${ENV:-default}` works in every string.
- A target's `mcp` is any MCP server exposing `ui_reset`, `ui_navigate`, `ui_page_source`,
  `ui_tap`, `ui_fill` (+ optional `ui_start`, `ui_screenshot`, `ui_record_start/stop`).
- `media.screenshots`: `steps` (after every step) · `failures` · `none`; `media.video`: `all` (default: web
  and mobile) · `mobile` · `none` — one recording per scenario. In the report every step has a clip of
  just that step (collapsed under it) and a ▶ button that plays only the step's slice; "▶ Full video"
  plays the whole recording.

## 5b. Targets and integrations (which tool touches the browser or device)

Each target names a platform and the **integration** the engine drives it with. The engine always
plans the steps; the integrated tool does the clicking, typing, reading and recording.

| `driver.type` | Platform | Interaction through | Needs |
|---|---|---|---|
| `mcp` | web / mobile | any MCP server with `ui_*` tools — ours: `web-mcp.ts` (Playwright), `rn-mcp.ts` (in-app RN bridge, iOS **and Android**) | Node; for RN, a Debug build |
| `playwright-mcp` | web | Microsoft's `@playwright/mcp` (`browser_snapshot/click/type/navigate`) | Chrome or a Playwright browser |
| `appium` | iOS / Android | an Appium 2+ server (XCUITest / UiAutomator2), W3C WebDriver | Appium + driver; the app installed |
| `maestro` | iOS / Android | the Maestro CLI (`hierarchy` + one-command flows) | Java + Maestro |
| Playwright Test | web | Playwright runs the features (`e2e-ai playwright init`), the engine drives its `page` | `@playwright/test` |

```json
"targets": {
  "web":                { "platform": "web", "driver": { "type": "mcp", "command": "node", "args": ["packages/e2e-ai/src/mcp/web-mcp.ts", "--base-url", "http://localhost:5180", "--start", "/app.html"], "cwd": ".." } },
  "web-playwright-mcp": { "platform": "web", "driver": { "type": "playwright-mcp", "baseUrl": "http://localhost:5180", "startPath": "/app.html", "command": "npx", "args": ["@playwright/mcp", "--browser", "chrome", "--headless", "--isolated"] } },
  "android":            { "platform": "mobile", "os": "android", "driver": { "type": "mcp", "command": "node", "args": ["packages/e2e-ai/src/mcp/rn-mcp.ts", "--launch", "adb shell monkey -p com.app.dev 1", "--android", "true"], "cwd": ".." } },
  "ios-appium":         { "platform": "mobile", "os": "ios", "driver": { "type": "appium", "url": "http://127.0.0.1:4723", "appId": "com.app.dev", "scheme": "myapp", "resetLink": "e2e-reset",
                          "capabilities": { "platformName": "iOS", "appium:automationName": "XCUITest", "appium:udid": "<sim>", "appium:bundleId": "com.app.dev", "appium:noReset": true } } },
  "android-maestro":    { "platform": "mobile", "os": "android", "driver": { "type": "maestro", "device": "emulator-5554", "appId": "com.app.dev", "scheme": "myapp", "resetLink": "e2e-reset" } }
}
```

- **Black-box mobile tools** (Appium, Maestro) open the guide's mobile routes as deep links
  `<scheme>://<route>` and reset with `<scheme>://<resetLink>`. The app must handle those links in
  **debug builds only** (Pocket Notes: `pocketnotes://signin`, `pocketnotes://notes?session=…`,
  `pocketnotes://e2e-reset`; Android needs a debug-only intent filter).
- **Android with the RN bridge**: `adb reverse tcp:4011 tcp:4011` (bridge), `tcp:4010` (API) and the
  Metro port before the run.
- **Ollama on Apple Silicon** may resolve a tag to an MLX build that cannot produce JSON-schema output
  (`doctor` says so); use the GGUF tag (e.g. `qwen3.5:4b-q4_K_M`).

### Playwright Test

```bash
npx e2e-ai playwright init          # writes e2e/playwright/{features.spec.ts,playwright.config.ts} once
npx playwright test -c e2e/playwright                    # plans new steps with the configured model
E2E_REPLAY=1 npx playwright test -c e2e/playwright       # CI: reviewed plans only
npx playwright test -c e2e/playwright --grep @smoke      # #smoke tags become Playwright @smoke tags
```

Each scenario is a Playwright test, each Gherkin step a `test.step` with its screenshot attached;
Playwright's video, trace and HTML report work as usual.

## 6. Report templates (`reports/templates/*.html`)

Each template is HTML + its own brief for the model:

- `<script type="text/x-e2e-ai-brief">` — who reads it and what matters to them;
- `data-section="…"` (`data-required` = never hidden, `data-pinned` = keeps its position);
- `data-e2e-ai-group-options="feature,tag,…"`, `data-e2e-ai-media-options="timeline,filmstrip,…"`;
- `data-ai="slot" data-ai-prompt="…"` (+ `data-ai-each="failure"`) — the prose the model writes;
- `const DATA = /*__REPORT_DATA__*/null;` — where run data (incl. `ai.view`, the chosen layout) lands.

The model returns a view plan + prose; numbers, names, files, tone and ship/no-ship verdicts are
checked against the data, and rejected text falls back to generated text (kept in `report.json`).

## 7. Commands

```bash
npx e2e-ai init                                          # set up a suite (root or an app folder); asks or takes flags
npm run e2e:ai:doctor                                    # docs, routines, model, MCP drivers
npm run e2e:ai -- run --target web                       # plan new steps + run + reports
npm run e2e:ai -- run --target web --replay              # CI: reviewed plans only, no model
npm run e2e:ai -- run --target web --no-cache            # evaluate the model: every step planned every time; plans file untouched
npm run e2e:ai -- run --target ios --model '"qwen3:1.7b"@http://10.0.0.5:8080/v1'
npm run e2e:ai -- run --target android                   # or ios-appium, android-appium, ios-maestro, android-maestro, web-playwright-mcp
npm run e2e:ai -- run --target web --benchmark '"qwen3:4b"@http://127.0.0.1:11434/v1;"qwen3:1.7b"@http://127.0.0.1:11434/v1'
npm run e2e:ai -- report e2e/reports/runs/<run> --template executive
```

Benchmark **modes** (`benchmark.modes` or `--modes no-cache,cache,one-fresh`), run per model in order:

| Mode | What runs | Shows |
|---|---|---|
| `no-cache` | every step planned by the model (its plans are recorded, nothing is read) | cost of interpreting a whole suite |
| `cache` | the plans that model just recorded, replayed | CI cost once plans are reviewed |
| `one-fresh` | cached, except one scenario planned from scratch (`--fresh-scenario "<name>"`, default: the scenario with most steps) | cost of a PR that adds/changes one scenario |

Per model and mode the comparison shows: total time, peak memory (Ollama's model size; plus a Docker
container's RAM with `--memory-docker <container>[@<docker context>]`), and **mean / median per step for
planned and for cached steps**, plus model time per planned step. `--environment "<text>"` labels the
machine. Run benchmarks with `--video none`: the per-step settle pause of video recording
(`media.stepPauseMs`, 600 ms) would otherwise inflate total times.

`--benchmark` alone uses `benchmark.models` from the config; add `--no-cache` so each model also plans
repeated steps (Backgrounds, routines) every time instead of reusing its own plans within the run. It runs the whole suite once per model with an **empty plan cache** — each model plans
every step itself from the docs and your features, nothing hand-labelled — and writes
`reports/runs/<slug>-benchmark/index.html` (comparison: scenarios passed, speed, size, guard repairs,
scenario × model matrix, recommended model) with each model's own run report under `models/<name>/`.

## 8. For AI agents writing these files

1. Read the app's API (OpenAPI, routes, controllers) and write `docs/<api>.md` in the format of §1 —
   only endpoints a test needs; one-sentence "when to use" per endpoint; show response fields
   later steps consume.
2. Open each screen (or read its components) and write `## Screens` with the **exact** visible
   texts and labels; then `## Routes` with web paths and mobile deep links, including one
   `{token}` route for a signed-in start.
3. Add `## Before every scenario` (the reset), a `## Glossary` for every domain word used in
   features, and **one `## Examples` line per step pattern**.
4. Write features with quoted exact values; move repeated setup into `.routine` files; put rules
   that must hold everywhere ("decline analytics", "close the promo popup") in `features/global.feature`
   and describe those popups in `## Screens`.
5. Run `npm run e2e:ai:doctor`, then `npm run e2e:ai -- run --target web`; read the plan diff in
   `.plans/plans.json` and the report; fix docs (not plans) when a step is planned wrongly.
