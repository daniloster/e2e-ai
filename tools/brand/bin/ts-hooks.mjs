// Node resolve hook for the brand CLI: workspace sources use extensionless relative imports, which
// plain Node does not resolve, so retry them as `.ts` and `/index.ts`.
const RETRYABLE = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT']);

const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../');
const hasExtension = (specifier) => /\.[A-Za-z0-9]+$/.test(specifier.split('/').at(-1) ?? '');

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (!RETRYABLE.has(error?.code) || !isRelative(specifier) || hasExtension(specifier))
      throw error;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Try the next candidate.
      }
    }
    throw error;
  }
}
