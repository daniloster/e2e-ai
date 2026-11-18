# AGENTS.md — instructions for AI agents

You are working with **e2e-ai**: plain-language end-to-end tests for web and mobile apps.

## If you are writing or running tests

Use only the CLI and the plain-text files; never write TypeScript glue.

1. `npx e2e-ai init --yes --project <root or app folder> --integrations <list>` (once) — writes the
   suite (config, docs skeletons, examples, globals file, templates, README) and npm scripts.
2. Fill `e2e/docs/*.md` from the app's real API and screens, following
   [`e2e/README.md`](e2e/README.md) §1–2 exactly (endpoint headings + Field tables; Screens, Routes,
   Before every scenario, Glossary, Examples). Docs are the model's only knowledge of the app.
3. Write `e2e/features/*.feature` (Gherkin + `#tags` + `@routine` calls), `e2e/routines/*.routine`
   and standing `@global` rules in `e2e/features/global.feature` (§3–4b). Quote exact values and
   visible texts.
4. Configure the model endpoint and the target's integration in `e2e/e2e-ai.config.json` (§5, §5b).
5. `npx e2e-ai doctor`, then `npx e2e-ai run --target <name>`; read the report in
   `e2e/reports/runs/<run>/index.html` and the plan diff in `e2e/.plans/plans.json`.
6. When a step is planned wrongly, fix the docs (screens/glossary/examples), not the plan file.
7. CI: `npx e2e-ai run --target <name> --replay --junit <file> [--shard i/n]`.

Command reference: [`packages/e2e-ai-cli/README.md`](packages/e2e-ai-cli/README.md) or `npx e2e-ai --help`.

## If you are changing the tool

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`CLAUDE.md`](CLAUDE.md). The engine is
`packages/e2e-ai` ([README](packages/e2e-ai/README.md)), the CLI `packages/e2e-ai-cli`, the editor
support `packages/vscode-e2e-ai` ([README](packages/vscode-e2e-ai/README.md)). Run
`npm run lint && npm run typecheck && npm test` before finishing.
