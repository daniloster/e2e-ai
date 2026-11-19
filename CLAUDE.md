# CLAUDE.md

Read `ARCHITECTURE.md` first. This file adds the rules every change must respect.

## What this repo is

- The product is the e2e tool: `packages/e2e-ai` (engine), `packages/e2e-ai-cli` (the `e2e-ai`
  command) and `packages/vscode-e2e-ai` (editor support). Test authors write only `.feature`,
  `.routine`, Markdown docs and `e2e-ai.config.json` — never TypeScript.
- `apps/`, `apps-modules/` and `tools/` are a demo app (Pocket Notes) the tool is exercised against.
  `apps-modules/fixture-api` is a dev/test-only in-memory API on `127.0.0.1:4010` with `/__test/*`
  seeding routes; it is never deployed.

## Engine rules (from the investigation, `docs/20261118-e2e-ai-cucumber-small-models/`)

- The model never decides whether a test passed: assertions are deterministic checks on what the
  driver returns, and plan repair never applies to assertions.
- Everything the model may call or open comes from the docs as JSON-schema enums; values must appear
  in the step, a routine argument or an earlier API response.
- Report prose written by the model is checked (numbers, names, files, tone, verdicts, echo) and falls
  back to generated text.
- Guards encode assumptions about the action vocabulary: re-validate them (and bump
  `PLANNER_VERSION`) whenever the vocabulary or prompts change.
- `routineSyntax.ts` is shared by the runner and the VS Code extension: keep it free of Node/VS Code
  imports so both match routine calls identically.

## Demo app rules

- `@pn/core` stays pure and deterministic (no clock, randomness, platform or UI imports).
- en-GB is the source language; es and pt-BR keep identical keys.
- The e2e deep links (`pocketnotes://signin`, `notes?session=…`, `e2e-reset`) and the in-app e2e
  bridge are on only in debug builds and the e2e build (`E2E_BUILD=1`, `E2E_HOOKS`); never in release.
