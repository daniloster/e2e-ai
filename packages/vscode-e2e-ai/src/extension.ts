// VS Code extension: colours (TextMate grammars in syntaxes/), routine completion, hover, go to
// definition, usages (CodeLens + references), outline, diagnostics and "open latest report".
import * as vscode from 'vscode';

import {
  CALL_LINE,
  callProblems,
  completionContext,
  GLOBAL_LINE,
  globalProblems,
  isGlobalSource,
  parseGlobals,
  label,
  matchRoutine,
  parseRoutineFile,
  routineAt,
  routineProblems,
  toSnippet,
  type Problem,
  type RoutineDef,
} from './logic.ts';

const SELECTOR: vscode.DocumentSelector = [{ language: 'e2e-feature' }, { language: 'e2e-routine' }];

class Index {
  defs: RoutineDef[] = [];
  tags = new Map<string, number>();
  readonly changed = new vscode.EventEmitter<void>();

  async refresh(): Promise<void> {
    const glob = vscode.workspace.getConfiguration('e2eAi').get<string>('routinesGlob', '**/*.routine');
    const defs: RoutineDef[] = [];
    for (const uri of await vscode.workspace.findFiles(glob, '**/node_modules/**')) {
      const text = (await vscode.workspace.openTextDocument(uri)).getText();
      defs.push(...parseRoutineFile(text, uri.toString()));
    }
    this.defs = defs;
    const tags = new Map<string, number>();
    for (const uri of await vscode.workspace.findFiles('**/*.feature', '**/node_modules/**')) {
      const text = (await vscode.workspace.openTextDocument(uri)).getText();
      for (const line of text.split(/\r?\n/)) {
        if (!/^\s*(#[A-Za-z0-9_][\w-]*\s*)+$/.test(line)) continue;
        for (const t of line.match(/#[A-Za-z0-9_][\w-]*/g) ?? []) tags.set(t, (tags.get(t) ?? 0) + 1);
      }
    }
    this.tags = tags;
    this.changed.fire();
  }

  locationOf(def: RoutineDef): vscode.Location {
    return new vscode.Location(vscode.Uri.parse(def.file), new vscode.Position(def.line - 1, 0));
  }
}

const GLOBAL_DOC = [
  '**@global** — a standing rule, in force for every scenario of the run.',
  '',
  'The pocket model plans it once (cached in the plans file): the texts that show the situation on screen,',
  'taken from your app guide, and the taps/fills that carry it out. The runner then checks every screen it',
  'reads; when all trigger texts are visible, it performs the rule and continues. The rule runs to the next',
  '`@global` or the end of the file.',
  '',
  'Example: `@global do not allow firebase user analytics` dismisses the consent sheet whenever it appears.',
].join('\n');

function shortPath(uri: string): string {
  return vscode.workspace.asRelativePath(vscode.Uri.parse(uri));
}

function routineMarkdown(def: RoutineDef): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Routine** · \`${shortPath(def.file)}:${def.line}\`\n\n`);
  md.appendCodeblock(`Routine: ${def.signature}`, 'e2e-routine');
  const params = def.params.map((p) => (p.kind === 'table' ? `\`${p.name}\` table (${(p.columns ?? []).join(', ')})` : `\`${p.name}\``));
  if (params.length) md.appendMarkdown(`Parameters: ${params.join(' · ')}\n\n`);
  const body = (nodes: RoutineDef['body'], indent = ''): string =>
    nodes
      .map((n) => (n.kind === 'each' ? `${indent}each \${table:${n.text}}\n${body(n.body ?? [], `${indent}  `)}` : `${indent}${n.kind === 'call' ? '@routine ' : ''}${n.text}`))
      .join('\n');
  md.appendCodeblock(body(def.body), 'e2e-routine');
  return md;
}

const toDiagnostic = (p: Problem) =>
  new vscode.Diagnostic(
    new vscode.Range(p.line, p.start, p.line, p.end),
    p.message,
    p.severity === 'error' ? vscode.DiagnosticSeverity.Error : p.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
  );

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const index = new Index();
  const diagnostics = vscode.languages.createDiagnosticCollection('e2e-ai');
  context.subscriptions.push(diagnostics, index.changed);

  const check = (doc: vscode.TextDocument) => {
    if (doc.languageId !== 'e2e-feature' && doc.languageId !== 'e2e-routine') return;
    const text = doc.getText();
    const problems = callProblems(text, index.defs);
    if (doc.languageId === 'e2e-feature') problems.push(...globalProblems(text));
    if (doc.languageId === 'e2e-routine') {
      // Compare the document as edited (not as indexed on disk) with the routines of other files.
      const own = parseRoutineFile(text, doc.uri.toString());
      const others = index.defs.filter((d) => d.file !== doc.uri.toString());
      problems.push(...routineProblems(own, [...others, ...own]));
    }
    diagnostics.set(doc.uri, problems.map(toDiagnostic));
  };
  const checkAll = () => vscode.workspace.textDocuments.forEach(check);

  await index.refresh();
  checkAll();
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{routine,feature}');
  const refresh = () => void index.refresh().then(checkAll);
  watcher.onDidChange(refresh);
  watcher.onDidCreate(refresh);
  watcher.onDidDelete(refresh);
  context.subscriptions.push(
    watcher,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => check(e.document)),
    vscode.workspace.onDidSaveTextDocument((d) => (d.languageId === 'e2e-routine' ? refresh() : check(d))),
    vscode.commands.registerCommand('e2eAi.reindex', refresh),
  );

  // Completion: routines (as snippets with tab stops and a table skeleton), tags, routine variables.
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(doc, pos) {
          const prefix = doc.lineAt(pos.line).text.slice(0, pos.character);
          const ctx = completionContext(prefix, doc.languageId as 'e2e-feature' | 'e2e-routine');
          if (!ctx) return undefined;
          const range = new vscode.Range(pos.line, ctx.start, pos.line, pos.character);
          if (ctx.kind === 'routine-keyword' || ctx.kind === 'routine-call') {
            // "@gl…" at the start of a line in a feature file: a standing @global rule.
            const globalItem: vscode.CompletionItem[] = [];
            if (ctx.kind === 'routine-keyword' && ctx.bare && doc.languageId === 'e2e-feature') {
              const g = new vscode.CompletionItem({ label: '@global', description: 'standing rule' }, vscode.CompletionItemKind.Keyword);
              g.insertText = new vscode.SnippetString('@global ${1:do not allow analytics when the app asks}');
              g.range = range;
              g.sortText = '0000';
              g.documentation = new vscode.MarkdownString(GLOBAL_DOC);
              globalItem.push(g);
            }
            return [...globalItem, ...index.defs.map((def, i) => {
              const item = new vscode.CompletionItem({ label: label(def), description: shortPath(def.file) }, vscode.CompletionItemKind.Function);
              const snippet = toSnippet(def, ctx.indent);
              item.insertText = new vscode.SnippetString(ctx.kind === 'routine-keyword' ? `@routine ${snippet}` : snippet);
              item.filterText = ctx.kind === 'routine-keyword' ? `@routine ${def.signature}` : def.signature;
              item.range = range;
              item.documentation = routineMarkdown(def);
              item.detail = 'routine';
              item.sortText = String(i + 1).padStart(4, '0');
              return item;
            })];
          }
          if (ctx.kind === 'tag') {
            return [...index.tags.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([tag, n]) => {
                const item = new vscode.CompletionItem({ label: tag, description: `${n} use${n === 1 ? '' : 's'}` }, vscode.CompletionItemKind.Keyword);
                item.range = range;
                return item;
              });
          }
          const def = routineAt(parseRoutineFile(doc.getText(), doc.uri.toString()), pos.line);
          return (def?.params ?? []).flatMap((p) => {
            const cols = p.kind === 'table' ? (p.columns ?? []).map((c) => ({ text: `\${${c}}`, detail: `column of ${p.name}` })) : [];
            const own = { text: p.kind === 'table' ? `\${table:${p.name}}` : `\${${p.name}}`, detail: p.kind === 'table' ? 'table parameter' : 'parameter' };
            return [own, ...cols].map((x) => {
              const item = new vscode.CompletionItem(x.text, vscode.CompletionItemKind.Variable);
              item.detail = x.detail;
              item.range = range;
              return item;
            });
          });
        },
      },
      '@',
      '#',
      '{',
      ' ',
    ),
  );

  const callAt = (doc: vscode.TextDocument, pos: vscode.Position) => {
    const m = CALL_LINE.exec(doc.lineAt(pos.line).text);
    return m ? matchRoutine(m[3] ?? '', index.defs) : undefined;
  };
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(doc, pos) {
        if (GLOBAL_LINE.test(doc.lineAt(pos.line).text)) {
          const md = new vscode.MarkdownString(GLOBAL_DOC);
          if (!isGlobalSource(doc.getText())) md.appendMarkdown('\n\n⚠ This file is a Gherkin feature: the runner reads `@global` rules only from globals files.');
          return new vscode.Hover(md);
        }
        const match = callAt(doc, pos);
        if (!match) return undefined;
        const md = routineMarkdown(match.def);
        const args = Object.entries(match.args);
        if (args.length) md.appendMarkdown(`\n\nThis call binds ${args.map(([k, v]) => `\`${k}\` = \`${v}\``).join(', ')}`);
        return new vscode.Hover(md);
      },
    }),
    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(doc, pos) {
        const match = callAt(doc, pos);
        return match ? index.locationOf(match.def) : undefined;
      },
    }),
  );

  // Usages: every `@routine` call (features and routines) that matches a routine.
  const usages = async (def: RoutineDef): Promise<vscode.Location[]> => {
    const out: vscode.Location[] = [];
    for (const uri of await vscode.workspace.findFiles('**/*.{feature,routine}', '**/node_modules/**')) {
      const doc = await vscode.workspace.openTextDocument(uri);
      for (let i = 0; i < doc.lineCount; i++) {
        const m = CALL_LINE.exec(doc.lineAt(i).text);
        if (m && matchRoutine(m[3] ?? '', index.defs)?.def.signature === def.signature) out.push(new vscode.Location(uri, new vscode.Position(i, 0)));
      }
    }
    return out;
  };
  context.subscriptions.push(
    vscode.languages.registerReferenceProvider(SELECTOR, {
      async provideReferences(doc, pos) {
        const def =
          callAt(doc, pos)?.def ?? (doc.languageId === 'e2e-routine' ? routineAt(index.defs.filter((d) => d.file === doc.uri.toString()), pos.line) : undefined);
        return def ? usages(def) : undefined;
      },
    }),
    vscode.languages.registerCodeLensProvider(
      { language: 'e2e-routine' },
      {
        onDidChangeCodeLenses: index.changed.event,
        async provideCodeLenses(doc) {
          const defs = index.defs.filter((d) => d.file === doc.uri.toString());
          return Promise.all(
            defs.map(async (def) => {
              const locs = await usages(def);
              const pos = new vscode.Position(def.line - 1, 0);
              return new vscode.CodeLens(new vscode.Range(pos, pos), {
                title: locs.length ? `${locs.length} usage${locs.length === 1 ? '' : 's'}` : 'not used yet',
                command: locs.length ? 'editor.action.showReferences' : '',
                arguments: [doc.uri, pos, locs],
              });
            }),
          );
        },
      },
    ),
  );

  // Outline: Feature / Background / Scenario / Routine.
  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(doc) {
        const out: vscode.DocumentSymbol[] = [];
        if (doc.languageId === 'e2e-feature' && isGlobalSource(doc.getText())) {
          return parseGlobals(doc.getText()).rules.map((r) => {
            const range = new vscode.Range(r.line - 1, 0, r.endLine - 1, doc.lineAt(r.endLine - 1).text.length);
            return new vscode.DocumentSymbol(r.text, '@global', vscode.SymbolKind.Constant, range, doc.lineAt(r.line - 1).range);
          });
        }
        let parent: vscode.DocumentSymbol | undefined;
        for (let i = 0; i < doc.lineCount; i++) {
          const l = doc.lineAt(i);
          const m = /^\s*(Feature|Rule|Background|Scenario Outline|Scenario|Examples|Routine):\s*(.*)$/.exec(l.text);
          if (!m) continue;
          const kind = m[1] === 'Feature' || m[1] === 'Rule' ? vscode.SymbolKind.Module : m[1] === 'Routine' ? vscode.SymbolKind.Function : vscode.SymbolKind.Event;
          const sym = new vscode.DocumentSymbol(m[2] || (m[1] as string), m[1] as string, kind, l.range, l.range);
          if ((m[1] === 'Feature' || m[1] === 'Routine') && kind !== vscode.SymbolKind.Event) {
            out.push(sym);
            parent = m[1] === 'Feature' ? sym : undefined;
          } else if (parent) parent.children.push(sym);
          else out.push(sym);
        }
        return out;
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('e2eAi.openLatestReport', async () => {
      const glob = vscode.workspace.getConfiguration('e2eAi').get<string>('reportsGlob', '**/e2e/reports/*/index.html');
      const files = await vscode.workspace.findFiles(glob, '**/node_modules/**');
      if (files.length === 0) return void vscode.window.showInformationMessage('No E2E report yet. Run the suite first.');
      const stats = await Promise.all(files.map(async (f) => ({ f, t: (await vscode.workspace.fs.stat(f)).mtime })));
      stats.sort((a, b) => b.t - a.t);
      await vscode.env.openExternal((stats[0] as { f: vscode.Uri }).f);
    }),
  );
}

export function deactivate(): void {}
