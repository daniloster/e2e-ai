// @pn/e2e-ai — the engine: Gherkin features (+ #tags, @routine, several Backgrounds) and Markdown app
// docs → step plans by a small model (constrained JSON + deterministic guards) → integrations
// (MCP servers, Playwright, Appium, Maestro, RN bridge) → reports and model benchmarks.
// The command line lives in @pn/e2e-ai-cli; Playwright Test integration in '@pn/e2e-ai/playwright'.
export * from './types.ts';

// Authoring formats
export { parseFeature, routineCall } from './gherkin.ts';
export type { Scenario, ScenarioStep } from './gherkin.ts';
export { preprocessFeature, matchesTags, hashTag } from './dialect.ts';
export { parseRoutineFile, matchRoutine, toSnippet } from './routineSyntax.ts';
export type { RoutineDef, RoutineMatch } from './routineSyntax.ts';
export { loadRoutines, expandCall } from './routines.ts';
export { isGlobalSource, parseGlobals } from './globalSyntax.ts';
export type { GlobalRule, GlobalProblem } from './globalSyntax.ts';
export { loadGlobals, planGlobal, groundTriggers, GLOBAL_PLANNER_VERSION } from './globals.ts';
export type { RoutineLibrary, Origin } from './routines.ts';
export { parseApiDoc, parseAppGuide, contextFromDocs, callEndpoint, lookupFact } from './docs.ts';
export type { Endpoint, AppGuide } from './docs.ts';
export { loadConfig } from './config.ts';
export type { E2eConfig, TargetConfig } from './config.ts';

// Planning
export { buildCatalog, describeCatalog, catalogFingerprint } from './catalog.ts';
export type { Catalog } from './catalog.ts';
export { createLlm, createOpenAiLlm, createOllamaLlm, parseModelSpecs, modelInfo } from './llm.ts';
export type { Llm, LlmStats, JsonSchema, ModelConfig } from './llm.ts';
export { planStep, guardActions, quotedValues, PLANNER_VERSION } from './planner.ts';
export { ground, groundGroup, scoreElement, tokens } from './grounder.ts';
export { openPlanCache, planKey } from './cache.ts';
export type { PlanCache } from './cache.ts';

// Running
export { runScenario, expandRoutines } from './runner.ts';
export type { RunOptions, ScenarioReport, StepReport, GlobalFire } from './runner.ts';
export { createDriver, withRoutes } from './drivers/index.ts';
export type { DriverConfig } from './drivers/index.ts';
export { createWebDriver } from './drivers/web.ts';
export { createRnBridgeDriver } from './drivers/rnBridge.ts';
export { createAdbDriver, parseUiAutomator } from './drivers/adb.ts';
export { createAppiumDriver, parseXcuiSource } from './drivers/appium.ts';
export { createMaestroDriver, parseMaestroHierarchy } from './drivers/maestro.ts';
export { createPlaywrightMcpDriver, parsePlaywrightSnapshot } from './drivers/playwrightMcp.ts';
export { createMcpDriver } from './mcp/mcpDriver.ts';
export type { McpServerSpec } from './mcp/mcpDriver.ts';

// Reports and benchmarks
export { collect, writeReport, rerender, findSlots, templateBrief, checkedText, verifyAiText, contradicts } from './report.ts';
export type { ReportData, ViewPlan } from './report.ts';
export { benchPlanner } from './bench.ts';
export type { Case, PlannerBenchSummary } from './bench.ts';
export {
  benchmarkFacts,
  modelResult,
  modeResult,
  recommend,
  renderBenchmarkHtml,
  startMemoryProbe,
  stat,
} from './benchmark.ts';
export type { BenchmarkData, BenchmarkMode, ModelResult, ModeResult } from './benchmark.ts';
