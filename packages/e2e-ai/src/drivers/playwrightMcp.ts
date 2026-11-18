// Web driver through Microsoft's Playwright MCP server (`@playwright/mcp`). The engine reads the
// server's ARIA snapshot and acts with its browser_* tools, so Playwright (driven by its own MCP
// server) does all browser interaction.
//
// Config: { "type": "playwright-mcp", "baseUrl": "http://localhost:5180", "startPath": "/app.html",
//           "command": "npx", "args": ["@playwright/mcp", "--browser", "chrome", "--headless", "--isolated"] }
// Snapshot lines look like:  - button "Sign in" [ref=e10] [cursor=pointer]
//                            - checkbox "Buy milk" [checked] [ref=e21]
//                            - generic [ref=e6]: Email
// Test ids are not part of the ARIA snapshot; grounding uses roles/names/text, and counts fall back
// to list items (grounder.groundGroup).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { Driver, UiElement } from '../types.ts';
import type { McpServerSpec } from '../mcp/mcpDriver.ts';

const LINE = /^(\s*)- ([\w-]+)(?: "((?:[^"\\]|\\.)*)")?((?: \[[^\]]+\])*)(?::\s*(.*))?$/;

/** The YAML-ish ARIA snapshot of @playwright/mcp → UiElements whose ref is the server's ref. */
export function parsePlaywrightSnapshot(text: string): UiElement[] {
  const yaml = /```yaml\n([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const out: UiElement[] = [];
  for (const line of yaml.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const role = m[2] as string;
    const name = (m[3] ?? '').replace(/\\"/g, '"');
    const attrs = m[4] ?? '';
    const ref = /\[ref=([^\]]+)\]/.exec(attrs)?.[1];
    if (!ref) continue;
    const inline = (m[5] ?? '').trim().replace(/^"|"$/g, '');
    const el: UiElement = { ref, role: role === 'generic' || role === 'paragraph' ? 'text' : role, name: name || inline, text: inline || name };
    if (role === 'checkbox') el.checked = /\[checked(?:=true)?\]/.test(attrs);
    if (role === 'textbox') {
      el.value = inline;
      el.text = '';
    }
    if (!el.name && !el.text && !['listitem', 'list', 'textbox', 'checkbox', 'button'].includes(role)) continue;
    out.push(el);
  }
  return out;
}

export function createPlaywrightMcpDriver(opts: { baseUrl: string; startPath?: string; server: McpServerSpec }): Driver {
  let client: Client | undefined;
  let last: UiElement[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    if (!client) throw new Error('playwright-mcp not started');
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = r.content?.find((c) => c.type === 'text')?.text ?? '';
    if (r.isError) throw new Error(`playwright-mcp ${name}: ${text.slice(0, 300)}`);
    return text;
  };
  const describe = (ref: string) => {
    const el = last.find((e) => e.ref === ref);
    return el ? `${el.role} "${el.name || el.text}"` : ref;
  };
  const url = (t: string) => new URL(t, opts.baseUrl).toString();
  return {
    platform: 'web',
    name: 'playwright-mcp',
    async start() {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      client = new Client({ name: 'e2e-ai-runner', version: '0.1.0' });
      await client.connect(
        new StdioClientTransport({
          command: opts.server.command,
          args: opts.server.args ?? [],
          env: { ...env, ...(opts.server.env ?? {}) },
          ...(opts.server.cwd ? { cwd: opts.server.cwd } : {}),
          stderr: 'ignore',
        }),
      );
    },
    async stop() {
      await call('browser_close').catch(() => undefined);
      await client?.close();
      client = undefined;
    },
    async resetApp() {
      // --isolated: closing the browser drops cookies and storage; the next navigate opens a fresh one.
      await call('browser_close').catch(() => undefined);
      await call('browser_navigate', { url: url(opts.startPath ?? '/') });
    },
    async openRoute() {
      throw new Error('playwright-mcp opens routes through navigate(target)');
    },
    async navigate(target) {
      await call('browser_navigate', { url: url(target) });
    },
    async snapshot() {
      last = parsePlaywrightSnapshot(await call('browser_snapshot'));
      return last;
    },
    async tap(ref) {
      await call('browser_click', { element: describe(ref), target: ref });
    },
    async fill(ref, text) {
      await call('browser_type', { element: describe(ref), target: ref, text });
    },
    async screenshot(path) {
      await call('browser_take_screenshot', { filename: path, type: 'png' });
    },
  };
}
