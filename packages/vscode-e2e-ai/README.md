# E2E AI — Features & Routines (VS Code)

For `.feature` and `.routine` files used by `@pn/e2e-ai`.

- **Colours**: Given / When / Then in distinct colours, `#tags` (not comments — a comment is `# text`),
  `@routine` calls, `"strings"`, `${params}`, `${table:name[cols]}`, `<outline params>`, tables, `via API`.
- **Completion**: type `@` (or `@routine `) for every routine in the workspace, inserted as a snippet
  with tab stops and a table skeleton; `#` for tags already used; `${` inside a routine for its
  parameters and table columns.
- **Hover / Go to definition** on a `@routine` line; **Find all references** and a **"N usages"**
  CodeLens on each `Routine:`; **Outline**.
- **Diagnostics** (same matcher as the runner): unknown routine calls, a routine that needs a table
  without one, unknown `${variables}`, `each` over an unknown table, duplicate signatures.
- **`@global` rules** (globals files such as `features/global.feature`): `@global` and the rule text
  coloured across continuation lines, `@gl…` completion at the start of a line, hover explaining how
  rules fire, one outline entry per rule, and diagnostics for empty, stray and duplicate rules — plus a
  warning when `@global` is written inside a normal feature (the runner ignores it there). Parsing is
  the runner's own (`globalSyntax.ts`).
- **E2E AI: Open latest run report** command.

Build: `npm run package -w e2e-ai-vscode` → `dist/e2e-ai-vscode-0.1.0.vsix`, then
`code --install-extension packages/vscode-e2e-ai/dist/e2e-ai-vscode-0.1.0.vsix`.
