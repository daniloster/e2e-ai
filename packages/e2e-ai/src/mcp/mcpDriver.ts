// The runner's side of MCP: a Driver whose every operation is an MCP tool call on a driver server
// (ours — web-mcp / rn-mcp — or any server exposing the same ui_* tools). Route names from the app
// guide are resolved here to the platform's concrete target before `ui_navigate`.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import type { Driver, Platform, RouteSpec, UiElement } from '../types.ts';

export interface McpServerSpec {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export function fillTemplate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    if (v === undefined) throw new Error(`no value for {${k}} in ${template}`);
    return encodeURIComponent(v);
  });
}

export function createMcpDriver(opts: { name: string; platform: Platform; server: McpServerSpec; routes: Record<string, RouteSpec> }): Driver {
  let client: Client | undefined;
  let tools: string[] = [];
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<string> => {
    if (!client) throw new Error('MCP driver not started');
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content?: { type: string; text?: string }[] };
    const text = r.content?.find((c) => c.type === 'text')?.text ?? '';
    if (r.isError) throw new Error(`${opts.name}.${name}: ${text}`);
    return text;
  };
  return {
    platform: opts.platform,
    name: `mcp:${opts.name}`,
    async start() {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
      const transport = new StdioClientTransport({
        command: opts.server.command,
        args: opts.server.args ?? [],
        env: { ...env, ...(opts.server.env ?? {}) },
        ...(opts.server.cwd ? { cwd: opts.server.cwd } : {}),
        stderr: 'inherit',
      });
      client = new Client({ name: 'e2e-ai-runner', version: '0.1.0' });
      await client.connect(transport);
      tools = (await client.listTools()).tools.map((t) => t.name);
      const missing = ['ui_reset', 'ui_navigate', 'ui_page_source', 'ui_tap', 'ui_fill'].filter((t) => !tools.includes(t));
      if (missing.length) throw new Error(`MCP server ${opts.name} lacks tools: ${missing.join(', ')}`);
      if (tools.includes('ui_start')) await call('ui_start');
    },
    async stop() {
      if (!client) return;
      await call('ui_stop').catch(() => undefined);
      await client.close();
      client = undefined;
    },
    resetApp: async () => void (await call('ui_reset')),
    async openRoute(route, params = {}) {
      const spec = opts.routes[route];
      const template = opts.platform === 'web' ? spec?.web : spec?.mobile;
      if (!template) throw new Error(`route ${route} has no ${opts.platform} target in the app guide`);
      await call('ui_navigate', { target: fillTemplate(template, params) });
    },
    navigate: async (target) => void (await call('ui_navigate', { target })),
    async snapshot() {
      return (JSON.parse(await call('ui_page_source')) as { elements: UiElement[] }).elements;
    },
    tap: async (ref) => void (await call('ui_tap', { ref })),
    fill: async (ref, text) => void (await call('ui_fill', { ref, text })),
    screenshot: async (path) => void (await call('ui_screenshot', { path })),
    async startRecording(stem) {
      if (!tools.includes('ui_record_start')) throw new Error(`${opts.name} has no video tool`);
      await call('ui_record_start', { stem });
    },
    async stopRecording() {
      if (!tools.includes('ui_record_stop')) return undefined;
      return (await call('ui_record_stop')) || undefined;
    },
  };
}
