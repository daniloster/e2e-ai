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
  error?: { message?: string } | string;
}

/**
 * Any OpenAI-compatible endpoint (llama.cpp `llama-server`, Ollama `/v1`, vLLM, LM Studio, a phone
 * running llama.rn behind a small HTTP shim…). Structured output via `response_format: json_schema`;
 * `reasoning_effort: "none"` turns hybrid thinking models (Qwen3) into direct answerers where the
 * server supports it, and is ignored elsewhere.
 */
export function createOpenAiLlm(opts: { endpoint: string; model: string; apiKey?: string; timeoutMs?: number }): Llm {
  const stats: LlmStats = { calls: 0, promptTokens: 0, outputTokens: 0, ms: 0 };
  const url = `${opts.endpoint.replace(/\/$/, '')}/chat/completions`;
  return {
    model: opts.model,
    stats,
    async json<T>({ system, prompt, schema }: { system: string; prompt: string; schema: JsonSchema }) {
      const t0 = performance.now();
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
        body: JSON.stringify({
          model: opts.model,
          temperature: 0,
          seed: 7,
          reasoning_effort: 'none',
          // Plans and report prose are short: a cap stops runaway generations (Q-14) long before the timeout.
          max_tokens: 700,
          response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const body = (await res.json()) as OpenAiResponse;
      if (!res.ok || body.error) {
        const msg = typeof body.error === 'string' ? body.error : (body.error?.message ?? String(res.status));
        throw new Error(`${opts.model} @ ${opts.endpoint}: ${msg}`);
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
}

export function createLlm(cfg: ModelConfig): Llm {
  if (cfg.provider === 'ollama') return createOllamaLlm(cfg.name, { host: cfg.endpoint.replace(/\/v1\/?$/, '') });
  const apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
  return createOpenAiLlm({ endpoint: cfg.endpoint, model: cfg.name, ...(apiKey ? { apiKey } : {}) });
}

/**
 * `"qwen3:4b"@http://127.0.0.1:11434/v1;"qwen3:1.7b"@http://10.0.0.5:8080/v1` → model configs.
 * A spec without `@endpoint` uses the default endpoint (from the config file). The older `>>`
 * separator is still accepted. Quote names that contain `@`.
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
      const endpoint = (rawEndpoint ?? '').trim().replace(/^["']|["']$/g, '') || defaults.endpoint;
      if (!name) throw new Error(`bad model spec "${one}" (want "name"@endpoint)`);
      return { ...defaults, name, endpoint };
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
