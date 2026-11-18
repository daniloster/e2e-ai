// The production Content-Security-Policy, read from firebase.json at call time (ARCHITECTURE.md §12:
// one source), and a header merge that applies it to a served document.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CSP_KEY = 'content-security-policy';

interface HeaderRule {
  source?: string;
  headers?: { key: string; value: string }[];
}

// The CSP of the hosting.headers rule whose source is '**'; throws unless it is the only CSP.
export function readProductionCsp(
  firebaseJsonPath: string = fileURLToPath(new URL('../firebase.json', import.meta.url)),
): string {
  const config = JSON.parse(readFileSync(firebaseJsonPath, 'utf8')) as {
    hosting?: { headers?: HeaderRule[] };
  };
  const found: { source: string | undefined; value: string }[] = [];
  for (const rule of config.hosting?.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key.toLowerCase() === CSP_KEY)
        found.push({ source: rule.source, value: header.value });
    }
  }
  if (found.length > 1) {
    throw new Error(
      `${firebaseJsonPath}: ${found.length} rules set a CSP (${found.map((f) => f.source).join(', ')}); expected only "**"`,
    );
  }
  const [only] = found;
  if (only === undefined || only.source !== '**') {
    throw new Error(`${firebaseJsonPath}: no Content-Security-Policy on the "**" hosting rule`);
  }
  return only.value;
}

// A copy of headers with any content-security-policy (any case) replaced by csp under the lower-case key.
export function withCsp(headers: Record<string, string>, csp: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== CSP_KEY) out[key] = value;
  }
  out[CSP_KEY] = csp;
  return out;
}
