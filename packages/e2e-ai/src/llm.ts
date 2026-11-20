// The LLM port. The planner needs only one primitive: "given this prompt, return JSON matching this
// schema". Ollama implements it with grammar-constrained decoding (`format: <JSON schema>`), which
// is what makes 0.6B–3B models usable here: they cannot emit an invalid shape, only wrong values.
// Ollama runs the same GGUF weights llama.cpp / llama.rn run on a phone.

export interface JsonSchema {
  [k: string]: unknown;
}

export interface LlmStats {
  calls: number;
  promptTokens: number;
  outputTokens: number;
  ms: number;
}

export interface Llm {
  readonly model: string;
  readonly stats: LlmStats;
  json<T>(req: { system: string; prompt: string; schema: JsonSchema }): Promise<T>;
}

interface OllamaChatResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export function createOllamaLlm(
  model: string,
  opts: { host?: string; numCtx?: number; timeoutMs?: number } = {},
): Llm {
  const host = opts.host ?? process.env.OLLAMA_HOST_URL ?? 'http://127.0.0.1:11434';
  const stats: LlmStats = { calls: 0, promptTokens: 0, outputTokens: 0, ms: 0 };
  return {
    model,
    stats,
    async json<T>({ system, prompt, schema }: { system: string; prompt: string; schema: JsonSchema }) {
      const t0 = performance.now();
      const res = await fetch(`${host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        body: JSON.stringify({
          model,
          stream: false,
          think: false, // qwen3-style hybrid models: no reasoning trace, answer directly
          format: schema,
          keep_alive: '30m',
          options: { temperature: 0, seed: 7, num_ctx: opts.numCtx ?? 8192, num_predict: 700 },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const body = (await res.json()) as OllamaChatResponse;
      if (!res.ok || body.error) throw new Error(`ollama ${model}: ${body.error ?? res.status}`);
      stats.calls += 1;
      stats.promptTokens += body.prompt_eval_count ?? 0;
      stats.outputTokens += body.eval_count ?? 0;
      stats.ms += performance.now() - t0;
      const content = body.message?.content ?? '';
      try {
        return JSON.parse(content) as T;
      } catch {
        throw new Error(`ollama ${model}: not JSON: ${content.slice(0, 200)}`);
      }
    },
  };
}

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; failed_generation?: string } | string;
}

/**
 * Any OpenAI-compatible endpoint (llama.cpp `llama-server`, Ollama `/v1`, vLLM, LM Studio, a phone
 * running llama.rn behind a small HTTP shim…). Structured output via `response_format: json_schema`;
 * `reasoning_effort: "none"` turns hybrid thinking models (Qwen3) into direct answerers where the
 * server supports it, and is ignored elsewhere.
 */
/** How long to wait before retrying a rate-limited request: Retry-After, else the "try again in 7.5s"
 * hint hosted APIs put in the message, else `fallbackMs`. Capped at a minute. */
/**
 * Hosted strict structured output (Groq, OpenAI) rejects an object schema that does not say
 * `additionalProperties: false`. Returns a copy with that set on every object that leaves it open;
 * local servers get the schema unchanged so their constrained decoding (and benchmarks) stay as they were.
 */
export function strictJsonSchema(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      // `properties` / `$defs` map names to schemas; `enum` / `const` / `required` are data, not schemas.
      if ((k === 'properties' || k === '$defs' || k === 'definitions') && v && typeof v === 'object') {
        out[k] = Object.fromEntries(Object.entries(v).map(([name, s]) => [name, walk(s)]));
      } else if (k === 'enum' || k === 'const' || k === 'required' || k === 'default' || k === 'examples') {
        out[k] = v;
      } else {
        out[k] = walk(v);
      }
    }
    const isObject = out.type === 'object' || (Array.isArray(out.type) && out.type.includes('object')) || 'properties' in out;
    if (isObject && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(schema) as JsonSchema;
}

/**
 * A hosted strict mode (Groq) checks the schema after generating, where a local grammar makes a bad
 * shape impossible. The argument prompt says `use "" if the step does not say` for optional params,
 * and gpt-oss follows it even for a boolean (`"done": ""`), so the request fails. This reads `""` in a
 * non-string field as "not given" (the planner's own convention for strings) and `"true"`/`"false"`
 * as booleans. Returns undefined unless the result fully
 * matches the schema (types, enums, required, no extra properties), so nothing else is papered over.
 */
export function conformToSchema(value: unknown, schema: JsonSchema): unknown {
  const FAIL = Symbol('fail');
  const types = (s: JsonSchema): string[] => (Array.isArray(s.type) ? (s.type as string[]) : typeof s.type === 'string' ? [s.type] : []);
  const fits = (v: unknown, t: string): boolean =>
    t === 'null' ? v === null
    : t === 'array' ? Array.isArray(v)
    : t === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v)
    : t === 'integer' ? Number.isInteger(v)
    : typeof v === t;
  const walk = (v: unknown, s: JsonSchema): unknown => {
    if (Array.isArray(s.anyOf)) {
      for (const alt of s.anyOf as JsonSchema[]) {
        const r = walk(v, alt);
        if (r !== FAIL) return r;
      }
      return FAIL;
    }
    const ts = types(s);
    if (ts.includes('boolean') && (v === 'true' || v === 'false')) v = v === 'true';
    if (ts.length && !ts.some((t) => fits(v, t))) return FAIL;
    if (Array.isArray(s.enum) && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) return FAIL;
    if (s.const !== undefined && JSON.stringify(s.const) !== JSON.stringify(v)) return FAIL;
    if (Array.isArray(v)) {
      const items = (s.items ?? {}) as JsonSchema;
      const out = v.map((x) => walk(x, items));
      return out.includes(FAIL) ? FAIL : out;
    }
    if (v && typeof v === 'object') {
      const props = (s.properties ?? {}) as Record<string, JsonSchema>;
      const required = new Set((s.required ?? []) as string[]);
      const out: Record<string, unknown> = {};
      const notGiven = new Set<string>();
      for (const [k, x] of Object.entries(v)) {
        const ps = props[k];
        if (!ps) {
          if (s.additionalProperties === false) return FAIL;
          out[k] = x;
          continue;
        }
        if (x === '' && types(ps).length && !types(ps).includes('string')) {
          notGiven.add(k);
          continue;
        }
        const r = walk(x, ps);
        if (r === FAIL) return FAIL;
        out[k] = r;
      }
      for (const k of required) if (!(k in out) && !notGiven.has(k)) return FAIL;
      return out;
    }
    return v;
  };
  const r = walk(value, schema);
  return r === FAIL ? undefined : r;
}

export function rateLimitDelayMs(retryAfter: string | null, message: string, fallbackMs = 5000): number {
  const header = retryAfter ? Number(retryAfter) * 1000 : NaN;
  const m = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(message);
  const hinted = m ? (Number(m[1] ?? 0) * 60 + Number(m[2]) / (m[3] === 'ms' ? 1000 : 1)) * 1000 : NaN;
  const ms = Number.isFinite(header) ? header : Number.isFinite(hinted) ? hinted : fallbackMs;
  return Math.min(60_000, Math.max(250, Math.ceil(ms) + 250));
}

export function createOpenAiLlm(opts: {
  endpoint: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  /** `none` (default) makes hybrid models answer directly; reasoning-only models (gpt-oss) need `low`+. */
  reasoningEffort?: string;
  /** Rate-limited (429) requests are retried this many times (default 8), waiting as the server asks. */
  maxRetries?: number;
}): Llm {
  const stats: LlmStats = { calls: 0, promptTokens: 0, outputTokens: 0, ms: 0 };
  const url = `${opts.endpoint.replace(/\/$/, '')}/chat/completions`;
  return {
    model: opts.model,
    stats,
    async json<T>({ system, prompt, schema }: { system: string; prompt: string; schema: JsonSchema }) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      const effort = opts.reasoningEffort ?? 'none';
      const payload = JSON.stringify({
        model: opts.model,
        temperature: 0,
        seed: 7,
        reasoning_effort: effort,
        // Plans and report prose are short: a cap stops runaway generations (Q-14) long before the
        // timeout. A reasoning model spends tokens thinking first, so it gets more room.
        max_tokens: effort === 'none' ? 700 : 4000,
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema: opts.apiKey ? strictJsonSchema(schema) : schema } },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      });
      let t0 = performance.now();
      let res: Response;
      let body: OpenAiResponse;
      for (let attempt = 0; ; attempt++) {
        t0 = performance.now(); // time spent waiting out a rate limit is not model time
        res = await fetch(url, { method: 'POST', headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000), body: payload });
        body = (await res.json().catch(() => ({}))) as OpenAiResponse;
        // Hosted providers name the account in limit messages; reports must not carry it.
        const msg = (typeof body.error === 'string' ? body.error : (body.error?.message ?? String(res.status))).replace(/\borg_[0-9A-Za-z]{12,}/g, 'org_…');
        if (res.status === 429 && attempt < (opts.maxRetries ?? 8)) {
          await new Promise((r) => setTimeout(r, rateLimitDelayMs(res.headers.get('retry-after'), msg)));
          continue;
        }
        if (!res.ok || body.error) {
          // Hosted strict mode validates after generating; say what the model actually wrote.
          const failed = typeof body.error === 'object' ? body.error.failed_generation : undefined;
          if (failed && opts.apiKey) {
            let conformed: unknown;
            try {
              conformed = conformToSchema(JSON.parse(failed), schema);
            } catch {
              conformed = undefined;
            }
            if (conformed !== undefined) {
              stats.calls += 1;
              stats.ms += performance.now() - t0;
              return conformed as T;
            }
          }
          throw new Error(`${opts.model} @ ${opts.endpoint}: ${msg}${failed ? ` (model wrote: ${failed.slice(0, 400)})` : ''}`);
        }
        break;
      }
      stats.calls += 1;
      stats.promptTokens += body.usage?.prompt_tokens ?? 0;
      stats.outputTokens += body.usage?.completion_tokens ?? 0;
      stats.ms += performance.now() - t0;
      const content = body.choices?.[0]?.message?.content ?? '';
      try {
        return JSON.parse(content) as T;
      } catch {
        throw new Error(`${opts.model}: not JSON: ${content.slice(0, 200)}`);
      }
    },
  };
}

export interface ModelConfig {
  provider?: 'openai' | 'ollama';
  endpoint: string;
  name: string;
  apiKeyEnv?: string;
  /** OpenAI-style `reasoning_effort` (default `none`); gpt-oss and other reasoning-only models: `low`. */
  reasoningEffort?: string;
}

export function createLlm(cfg: ModelConfig): Llm {
  if (cfg.provider === 'ollama') return createOllamaLlm(cfg.name, { host: cfg.endpoint.replace(/\/v1\/?$/, '') });
  const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
  if (cfg.apiKeyEnv && !apiKey) throw new Error(`model ${cfg.name}: set ${cfg.apiKeyEnv} (its API key)`);
  return createOpenAiLlm({
    endpoint: cfg.endpoint,
    model: cfg.name,
    ...(apiKey ? { apiKey } : {}),
    ...(cfg.reasoningEffort ? { reasoningEffort: cfg.reasoningEffort } : {}),
  });
}

/**
 * `"qwen3:4b"@http://127.0.0.1:11434/v1;"qwen3:1.7b"@http://10.0.0.5:8080/v1` → model configs.
 * A spec without `@endpoint` uses the default endpoint (from the config file). The older `>>`
 * separator is still accepted. Quote names that contain `@`.
 * Hosted APIs: options in brackets after the endpoint, the key by environment variable name only —
 * `"openai/gpt-oss-20b"@https://api.groq.com/openai/v1[key=GROQ_API_KEY,reasoning=low]`.
 */
export function parseModelSpecs(spec: string, defaults: ModelConfig): ModelConfig[] {
  return spec
    .split(';')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((one) => {
      // "name"@endpoint (quoted name: split after the closing quote) | name@endpoint | name>>endpoint
      const quoted = /^["']([^"']+)["']\s*(?:@|>>)\s*(.*)$/.exec(one);
      const sep = one.includes('>>') ? '>>' : '@';
      const at = one.indexOf(sep);
      const rawName = quoted ? quoted[1] : at < 0 ? one : one.slice(0, at);
      const rawEndpoint = quoted ? quoted[2] : at < 0 ? '' : one.slice(at + sep.length);
      const name = (rawName ?? '').trim().replace(/^["']|["']$/g, '');
      const opt = /^(.*?)\[([^\]]*)\]\s*$/.exec((rawEndpoint ?? '').trim());
      const endpoint = (opt ? (opt[1] ?? '') : (rawEndpoint ?? '')).trim().replace(/^["']|["']$/g, '') || defaults.endpoint;
      if (!name) throw new Error(`bad model spec "${one}" (want "name"@endpoint)`);
      const extra: Partial<ModelConfig> = {};
      for (const kv of (opt?.[2] ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
        const [k, v = ''] = kv.split('=').map((x) => x.trim());
        if (k === 'key' && /^[A-Z_][A-Z0-9_]*$/.test(v)) extra.apiKeyEnv = v;
        else if (k === 'reasoning' && /^(none|low|medium|high)$/.test(v)) extra.reasoningEffort = v;
        else throw new Error(`bad model option "${kv}" in "${one}" (want key=ENV_VAR_NAME or reasoning=none|low|medium|high)`);
      }
      // A model on another endpoint does not inherit the default model's API key.
      const { apiKeyEnv: defaultKey, ...rest } = defaults;
      const inherited = endpoint === defaults.endpoint && defaultKey ? { apiKeyEnv: defaultKey } : {};
      return { ...rest, ...inherited, name, endpoint, ...extra };
    });
}

/** Best-effort size/quantisation from an Ollama endpoint (empty for other servers). */
export async function modelInfo(cfg: ModelConfig): Promise<{ parameters?: string; quantization?: string; sizeGB?: number }> {
  const base = cfg.endpoint.replace(/\/v1\/?$/, '');
  try {
    const tags = (await (await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) })).json()) as {
      models?: { name: string; size: number; details?: { parameter_size?: string; quantization_level?: string } }[];
    };
    const m = tags.models?.find((x) => x.name === cfg.name || x.name === `${cfg.name}:latest`);
    if (!m) return {};
    const out: { parameters?: string; quantization?: string; sizeGB?: number } = { sizeGB: Math.round(m.size / 1e7) / 100 };
    if (m.details?.parameter_size) out.parameters = m.details.parameter_size;
    if (m.details?.quantization_level) out.quantization = m.details.quantization_level;
    return out;
  } catch {
    return {};
  }
}
