// Debug builds only: the @pn/e2e-ai "rn-bridge" driver's in-app half. Connects to the runner's
// WebSocket (ws://localhost:4011), answers `snapshot` from the React fiber tree (testID, role,
// accessibility label, text), and performs `tap` / `fill` by invoking the props a real touch would
// reach (onPress, onChangeText) — gray-box, like Testing Library's fireEvent, but in the real app.
// `reset` / `openRoute` are delegated to handlers the AppProvider registers. Never started in release.

/* eslint-disable @typescript-eslint/no-explicit-any -- React fibers are untyped internals */

export interface E2EHandlers {
  reset(): void | Promise<void>;
  openRoute(route: string, params: Record<string, string>): void | Promise<void>;
}

interface UiElement {
  ref: string;
  role: string;
  name: string;
  text: string;
  testId?: string;
  placeholder?: string;
  value?: string;
  checked?: boolean;
}

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;

let rootInstance: any = null;
let handlers: E2EHandlers | null = null;
let refs = new Map<string, any>();

/** Called by the E2EProbe class component (App.tsx) with `this`. */
export function setE2ERoot(instance: unknown): void {
  rootInstance = instance;
}

export function registerE2EHandlers(h: E2EHandlers): () => void {
  handlers = h;
  return () => {
    if (handlers === h) handlers = null;
  };
}

function currentRootFiber(): any {
  let f = rootInstance?._reactInternals;
  if (!f) return null;
  while (f.return) f = f.return;
  return f.stateNode?.current ?? f;
}

function textOf(fiber: any): string {
  const parts: string[] = [];
  const visit = (f: any) => {
    for (let c = f; c; c = c.sibling) {
      if (c.tag === HOST_TEXT && typeof c.memoizedProps === 'string') parts.push(c.memoizedProps);
      if (c.child) visit(c.child);
    }
  };
  if (fiber.child) visit(fiber.child);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/** The nearest prop named `name` on the component chain above a host fiber (stops at the next host). */
function handlerAbove(fiber: any, name: string): ((...a: any[]) => any) | null {
  if (typeof fiber.memoizedProps?.[name] === 'function') return fiber.memoizedProps[name];
  for (let f = fiber.return; f && f.tag !== HOST_COMPONENT; f = f.return) {
    const h = f.memoizedProps?.[name];
    if (typeof h === 'function') return h;
  }
  return null;
}

export function snapshot(): UiElement[] {
  const root = currentRootFiber();
  const out: UiElement[] = [];
  refs = new Map();
  if (!root) return out;
  const visit = (f: any) => {
    for (let c = f; c; c = c.sibling) {
      if (c.tag === HOST_COMPONENT && typeof c.type === 'string') {
        const p = c.memoizedProps ?? {};
        const isInput = /TextInput/i.test(c.type);
        const isText = /^RCT(Virtual)?Text$/.test(c.type);
        const onPress = isInput ? null : handlerAbove(c, 'onPress');
        const testId: string | undefined = p.testID ?? p.nativeID ?? undefined;
        const text = isInput ? '' : textOf(c);
        const label: string | undefined = p.accessibilityLabel ?? p['aria-label'];
        let role: string = p.role ?? p.accessibilityRole ?? '';
        if (!role) role = isInput ? 'textbox' : onPress && (p.accessible || testId) ? 'button' : isText ? 'text' : '';
        const keep = isInput || testId || (onPress && p.accessible) || (isText && text);
        if (keep) {
          const ref = String(out.length);
          const el: UiElement = { ref, role: role || 'group', name: label ?? (isInput ? (p.placeholder ?? '') : text), text };
          if (testId) el.testId = testId;
          if (p.placeholder) el.placeholder = p.placeholder;
          if (isInput) el.value = String(p.value ?? p.text ?? '');
          const checked = p.accessibilityState?.checked ?? p['aria-checked'];
          if (typeof checked === 'boolean') el.checked = checked;
          refs.set(ref, c);
          out.push(el);
        }
        // Text nodes carry their text already; do not list each nested span again.
        if (isText) continue;
      }
      if (c.child) visit(c.child);
    }
  };
  visit(root.child);
  return out;
}

function fiberOf(ref: string): any {
  const f = refs.get(ref);
  if (!f) throw new Error(`stale ref ${ref}`);
  return f;
}

export function tap(ref: string): void {
  const f = fiberOf(ref);
  const onPress = handlerAbove(f, 'onPress');
  if (!onPress) throw new Error(`ref ${ref} is not pressable`);
  onPress({ nativeEvent: {}, persist() {}, preventDefault() {} });
}

export function fill(ref: string, text: string): void {
  const f = fiberOf(ref);
  const onChangeText = handlerAbove(f, 'onChangeText');
  if (!onChangeText) throw new Error(`ref ${ref} is not a text input`);
  onChangeText(text);
}

async function handle(op: string, args: any): Promise<unknown> {
  switch (op) {
    case 'snapshot':
      return snapshot();
    case 'tap':
      return tap(String(args.ref));
    case 'fill':
      return fill(String(args.ref), String(args.text));
    case 'reset':
      if (!handlers) throw new Error('app not ready');
      return handlers.reset();
    case 'openRoute':
      if (!handlers) throw new Error('app not ready');
      return handlers.openRoute(String(args.route), args.params ?? {});
    default:
      throw new Error(`unknown op ${op}`);
  }
}

let started = false;

/** Keeps a connection to the e2e runner open while the debug app runs. */
export function startE2EBridge(url = 'ws://localhost:4011'): void {
  if (started) return;
  started = true;
  const connect = () => {
    const ws = new WebSocket(url);
    ws.onmessage = (ev: { data?: unknown }) => {
      const msg = JSON.parse(String(ev.data)) as { id: number; op: string; args: unknown };
      handle(msg.op, msg.args).then(
        result => ws.send(JSON.stringify({ id: msg.id, ok: true, result })),
        (e: unknown) =>
          ws.send(JSON.stringify({ id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) })),
      );
    };
    ws.onclose = () => setTimeout(connect, 1000);
    ws.onerror = () => undefined;
  };
  connect();
}
