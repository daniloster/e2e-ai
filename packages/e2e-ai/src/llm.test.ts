import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, expect, it } from 'vitest';

import { conformToSchema, createLlm, createOpenAiLlm, rateLimitDelayMs, strictJsonSchema } from './llm.ts';

describe('hosted OpenAI-compatible APIs', () => {
  it('waits as a rate limit asks: Retry-After, else the "try again in" hint, capped at a minute', () => {
    expect(rateLimitDelayMs('2', '')).toBe(2250);
    expect(rateLimitDelayMs(null, 'Rate limit reached ... Please try again in 7.5s.')).toBe(7750);
    expect(rateLimitDelayMs(null, 'Please try again in 1m2.5s')).toBe(60_000);
    expect(rateLimitDelayMs(null, 'try again in 120ms')).toBe(370);
    expect(rateLimitDelayMs(null, 'busy', 1000)).toBe(1250);
  });

  it('retries a 429, sends the key and reasoning effort, and gives a reasoning model more tokens', async () => {
    const seen: { auth?: string; body: Record<string, unknown> }[] = [];
    const server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ ...(req.headers.authorization ? { auth: req.headers.authorization } : {}), body: JSON.parse(raw) as Record<string, unknown> });
        res.setHeader('content-type', 'application/json');
        if (seen.length === 1) {
          res.statusCode = 429;
          res.setHeader('retry-after', '0');
          res.end(JSON.stringify({ error: { message: 'Rate limit reached. Please try again in 10ms.' } }));
          return;
        }
        res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    try {
      const llm = createOpenAiLlm({ endpoint, model: 'openai/gpt-oss-20b', apiKey: 'test-key', reasoningEffort: 'low' });
      expect(await llm.json({ system: 's', prompt: 'p', schema: { type: 'object' } })).toEqual({ ok: true });
      expect(seen).toHaveLength(2);
      expect(seen[1]?.auth).toBe('Bearer test-key');
      expect(seen[1]?.body).toMatchObject({ reasoning_effort: 'low', max_tokens: 4000 });
      expect(llm.stats).toMatchObject({ calls: 1, promptTokens: 3, outputTokens: 2 });
    } finally {
      server.close();
    }
  });

  it('refuses to start a model whose key variable is not set', () => {
    delete process.env.E2E_TEST_MISSING_KEY;
    expect(() => createLlm({ provider: 'openai', endpoint: 'http://x/v1', name: 'm', apiKeyEnv: 'E2E_TEST_MISSING_KEY' })).toThrow('set E2E_TEST_MISSING_KEY');
  });

  it('closes every object schema for hosted strict mode, leaving enums and data alone', () => {
    const schema = {
      type: 'object',
      properties: {
        steps: { type: 'array', items: { type: 'object', properties: { action: { enum: ['tap', 'fill'] } }, required: ['action'] } },
        extra: { type: 'object', additionalProperties: true },
        properties: { type: 'string' },
      },
      required: ['steps'],
    };
    const out = JSON.parse(JSON.stringify(strictJsonSchema(schema))) as typeof schema & { additionalProperties: unknown; properties: { steps: { items: { additionalProperties: unknown } }; extra: { additionalProperties: unknown } } };
    expect(out.additionalProperties).toBe(false);
    expect(out.properties.steps.items.additionalProperties).toBe(false);
    expect(out.properties.steps.items.properties.action).toEqual({ enum: ['tap', 'fill'] });
    expect(out.properties.extra.additionalProperties).toBe(true);
    expect(out.properties.properties).toEqual({ type: 'string' });
    expect(schema).not.toHaveProperty('additionalProperties');
  });

  const NOTE = {
    type: 'object',
    properties: { title: { type: 'string' }, description: { type: 'string' }, done: { type: 'boolean' }, kind: { enum: ['a', 'b'] } },
    required: ['title'],
    additionalProperties: false,
  };

  it('gives back the shape a grammar would have: drops an empty optional non-string, reads "true"/"false"', () => {
    expect(conformToSchema({ title: 'Buy milk', description: '', done: '' }, NOTE)).toEqual({ title: 'Buy milk', description: '' });
    expect(conformToSchema({ title: 'Buy milk', done: 'true' }, NOTE)).toEqual({ title: 'Buy milk', done: true });
    // The argument prompt asks for "" when the step does not say, so a required boolean may be "" too.
    expect(conformToSchema({ title: 'Buy milk', done: '' }, { ...NOTE, required: ['title', 'done'] })).toEqual({ title: 'Buy milk' });
  });

  it('still rejects anything else that breaks the schema', () => {
    expect(conformToSchema({ title: 'x', done: 'yes' }, NOTE)).toBeUndefined();
    expect(conformToSchema({ title: 'x', kind: 'c' }, NOTE)).toBeUndefined();
    expect(conformToSchema({ title: 'x', other: 1 }, NOTE)).toBeUndefined();
    expect(conformToSchema({ done: false }, NOTE)).toBeUndefined();
    expect(conformToSchema({ title: 'x', done: 0 }, NOTE)).toBeUndefined();
    expect(conformToSchema({ title: 'x', kind: '' }, NOTE)).toBeUndefined();
  });

  it('uses a hosted strict-mode rejection only when what the model wrote conforms', async () => {
    let reply = '{"title":"Buy milk","done":""}';
    const server = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: { message: "jsonschema: '/done' expected boolean, but got string", failed_generation: reply } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    try {
      const hosted = createOpenAiLlm({ endpoint, model: 'm', apiKey: 'test-key' });
      expect(await hosted.json({ system: 's', prompt: 'p', schema: NOTE })).toEqual({ title: 'Buy milk' });
      expect(hosted.stats.calls).toBe(1);
      reply = '{"title":"Buy milk","done":"maybe"}';
      await expect(hosted.json({ system: 's', prompt: 'p', schema: NOTE })).rejects.toThrow('model wrote: {"title":"Buy milk","done":"maybe"}');
      const local = createOpenAiLlm({ endpoint, model: 'm' });
      reply = '{"title":"Buy milk","done":""}';
      await expect(local.json({ system: 's', prompt: 'p', schema: NOTE })).rejects.toThrow('expected boolean');
    } finally {
      server.close();
    }
  });
});
