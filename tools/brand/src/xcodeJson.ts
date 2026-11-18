// JSON in the style Xcode writes asset-catalog Contents.json files, so opening the
// catalog in Xcode causes no drift. Callers pass objects with keys already in alphabetical order.
export function xcodeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(/^(\s*"[^"]*"): /gm, '$1 : ')}\n`;
}
