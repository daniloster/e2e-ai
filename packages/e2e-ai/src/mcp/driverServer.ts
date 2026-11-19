// Exposes a UI driver as an MCP server (stdio). The runner is the MCP client: the pocket model reads
// the page source these tools return and chooses which element to tap/fill; assertions are checked
// deterministically against the same page source. Any MCP server with these tool names can be used
// as a driver (configure it in e2e-ai.config.json).
//
// Tools: ui_start, ui_stop, ui_reset, ui_navigate{target}, ui_page_source, ui_tap{ref},
//        ui_fill{ref,text}, ui_screenshot{path}, ui_record_start{stem}, ui_record_stop
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import type { CloudConfig } from '../cloud/cloud.ts';
import { rolesFromEnv } from '../roles.ts';
import type { Driver } from '../types.ts';

const ok = (text = 'ok') => ({ content: [{ type: 'text' as const, text }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }] });

/** Cloud settings handed to an MCP driver server by the runner (`E2E_CLOUD`, JSON). */
export function cloudFromEnv(): { cloud?: CloudConfig; sessionName?: string } {
  const raw = process.env.E2E_CLOUD;
  if (!raw) return {};
  return { cloud: JSON.parse(raw) as CloudConfig, ...(process.env.E2E_SESSION_NAME ? { sessionName: process.env.E2E_SESSION_NAME } : {}) };
}

export async function serveDriver(driver: Driver, name: string): Promise<void> {
  rolesFromEnv();
  const server = new McpServer({ name, version: '0.1.0' });
  const tool = (
    id: string,
    description: string,
    shape: Record<string, z.ZodType>,
    run: (args: Record<string, unknown>) => Promise<string | void>,
  ) =>
    server.registerTool(id, { description, inputSchema: shape }, async (args: Record<string, unknown>) => {
      try {
        return ok((await run(args)) ?? 'ok');
      } catch (e) {
        return fail(e);
      }
    });

  tool('ui_start', 'Start the driver (browser / app connection).', {}, async () => {
    await driver.start();
  });
  tool(
    'ui_stop',
    'Stop the driver; with the run outcome a cloud session is marked passed/failed.',
    { passed: z.boolean().optional(), scenarios: z.number().optional(), failed: z.number().optional() },
    async (a) => {
      await driver.stop(
        typeof a.passed === 'boolean' ? { passed: a.passed, scenarios: Number(a.scenarios ?? 0), failed: Number(a.failed ?? 0) } : undefined,
      );
    },
  );
  tool('ui_links', 'Links to watch this run elsewhere (cloud dashboard, video) as JSON [{label,url}].', {}, async () =>
    JSON.stringify((await driver.links?.()) ?? []),
  );
  tool('ui_reset', 'Bring the app to a clean, signed-out start state.', {}, async () => {
    await driver.resetApp();
  });
  tool('ui_navigate', 'Open a target: a URL path on the web, "route?param=value" on mobile.', { target: z.string() }, async (a) => {
    if (!driver.navigate) throw new Error(`${driver.name} cannot navigate`);
    await driver.navigate(String(a.target));
  });
  tool(
    'ui_page_source',
    'The current screen as a JSON list of elements: ref, role, name, text, testId, placeholder, value, checked.',
    {},
    async () => JSON.stringify({ platform: driver.platform, driver: driver.name, elements: await driver.snapshot() }),
  );
  tool('ui_tap', 'Tap/click the element with this ref (from the latest ui_page_source).', { ref: z.string() }, async (a) => {
    await driver.tap(String(a.ref));
  });
  tool('ui_fill', 'Replace the text of the input with this ref.', { ref: z.string(), text: z.string() }, async (a) => {
    await driver.fill(String(a.ref), String(a.text));
  });
  tool('ui_record_start', 'Start recording the screen to <stem>.mp4/.webm (absolute path without extension).', { stem: z.string() }, async (a) => {
    if (!driver.startRecording) throw new Error(`${driver.name} cannot record video`);
    await driver.startRecording(String(a.stem));
  });
  tool('ui_record_stop', 'Stop recording; returns the saved file path.', {}, async () => {
    if (!driver.stopRecording) throw new Error(`${driver.name} cannot record video`);
    return (await driver.stopRecording()) ?? '';
  });
  tool('ui_screenshot', 'Save a PNG of the screen to an absolute path.', { path: z.string() }, async (a) => {
    if (!driver.screenshot) throw new Error(`${driver.name} cannot take screenshots`);
    await driver.screenshot(String(a.path));
  });

  await server.connect(new StdioServerTransport());
  const shutdown = async () => {
    await driver.stop().catch(() => undefined);
    process.exit(0);
  };
  process.stdin.on('close', shutdown);
  process.on('SIGTERM', shutdown);
}

/** `--key value` pairs from argv. */
export function argv(): Record<string, string> {
  const out: Record<string, string> = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i] as string;
    if (k.startsWith('--')) out[k.slice(2)] = a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? 'true' : (a[++i] as string);
  }
  return out;
}
