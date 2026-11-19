// The shared vocabulary of @pn/e2e-ai: the UI model drivers expose, the app context ("pockets") a
// team provides, and the closed action language the planner emits.

export type Platform = 'web' | 'mobile';

/** One element of a UI snapshot, platform-neutral. `ref` is valid until the next snapshot. */
export interface UiElement {
  ref: string;
  role: string; // button, textbox, checkbox, link, heading, text, listitem, group, ...
  name: string; // accessible name (label, aria-label, accessibilityLabel, or its text)
  text: string; // visible text content
  testId?: string;
  placeholder?: string;
  value?: string;
  checked?: boolean;
}

export interface RunOutcome {
  passed: boolean;
  scenarios: number;
  failed: number;
}

export interface DriverLink {
  label: string;
  url: string;
}

/** A UI automation backend (Playwright, the RN bridge, adb/uiautomator, ...). */
export interface Driver {
  readonly platform: Platform;
  readonly name: string;
  start(): Promise<void>;
  /** Ends the session; `outcome` lets a cloud session be marked passed/failed in the vendor dashboard. */
  stop(outcome?: RunOutcome): Promise<void>;
  /** Where to watch this run elsewhere (cloud dashboard, video): shown in the log and the report. */
  links?(): Promise<DriverLink[]>;
  /** Brings the app to a clean, signed-out start state. */
  resetApp(): Promise<void>;
  /** Opens a named route of the app context (a URL on the web, a deep link or bridge call on mobile). */
  openRoute(route: string, params?: Record<string, string>): Promise<void>;
  snapshot(): Promise<UiElement[]>;
  tap(ref: string): Promise<void>;
  fill(ref: string, text: string): Promise<void>;
  /** Saves a PNG of the current screen (optional: reports show it when present). */
  screenshot?(path: string): Promise<void>;
  /** Opens a concrete target: a path/URL on the web, `route?param=value` on mobile. */
  navigate?(target: string): Promise<void>;
  /** Starts recording the screen; `stem` is a path without extension (the driver picks .mp4/.webm). */
  startRecording?(stem: string): Promise<void>;
  /** Stops recording; resolves to the saved file (absolute path), or undefined. */
  stopRecording?(): Promise<string | undefined>;
}

// ---------------------------------------------------------------- app context

export interface ParamSpec {
  type: 'string' | 'number' | 'boolean';
  description: string;
  optional?: boolean;
  enum?: readonly string[];
}

export interface PocketRunContext {
  driver: Driver;
  world: World;
}

/** A capability the planner may call: create data, or reach an app state (access). */
export interface PocketFn {
  description: string;
  params: Readonly<Record<string, ParamSpec>>;
  run(args: Record<string, unknown>, ctx: PocketRunContext): Promise<unknown>;
}

export interface RouteSpec {
  description: string;
  web?: string; // path (may contain {param})
  mobile?: string; // bridge route name or deep link
}

/** A worked example the planner sees as a few-shot demonstration. */
export interface PlanExample {
  step: string;
  actions: PlannedAction[];
}

/**
 * A pocket: a small, domain-scoped bundle of what the tool may use to satisfy steps —
 * data creation functions, access shortcuts, named routes, a glossary and examples.
 */
export interface Pocket {
  name: string;
  description: string;
  data?: Readonly<Record<string, PocketFn>>;
  access?: Readonly<Record<string, PocketFn>>;
  routes?: Readonly<Record<string, RouteSpec>>;
  /** Domain word -> how it shows in the UI ("note" -> "a row in the notes list"). */
  glossary?: Readonly<Record<string, string>>;
  examples?: readonly PlanExample[];
}

export interface AppContext {
  name: string;
  description: string;
  pockets: readonly Pocket[];
  web?: { baseUrl: string };
  mobile?: { appId: string };
  /** Runs before every scenario (reset the data API, ...). */
  beforeScenario?(ctx: PocketRunContext): Promise<void>;
}

// ---------------------------------------------------------------- plan language

export const ACTION_KINDS = [
  'call', // a pocket function (data or access)
  'open', // a named route
  'tap',
  'fill',
  'expect_visible',
  'expect_hidden',
  'expect_count',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

export interface PlannedAction {
  kind: ActionKind;
  fn?: string; // call: "pocket.fn"
  args?: Record<string, unknown>; // call
  route?: string; // open
  target?: string; // tap/fill/expect_*: natural-language element description
  value?: string; // fill: text; expect_visible/hidden: text that must (not) show
  count?: number; // expect_count
}

/** A UI target resolved to something stable enough to replay without the LLM. */
export interface ResolvedTarget {
  testId?: string;
  role: string;
  name: string;
  /** Count assertions: the repeated group the items matched (e.g. `note-row-*`, or `role:listitem`). */
  pattern?: string;
}

export interface StepPlan {
  step: string;
  actions: PlannedAction[];
  /** target description -> last element it resolved to (healed when it stops matching). */
  resolved: Record<string, ResolvedTarget>;
  model: string;
  createdAt: string;
  /** `@global` rules only: texts that must all be on screen for the rule's actions to run. */
  when?: string[];
}

// ---------------------------------------------------------------- runtime

/** Scenario-scoped memory: data created by pockets, shown to the planner as facts. */
export interface World {
  facts: Record<string, unknown>;
  remember(key: string, value: unknown): void;
}

export function createWorld(): World {
  const facts: Record<string, unknown> = {};
  return {
    facts,
    remember(key, value) {
      facts[key] = value;
    },
  };
}
