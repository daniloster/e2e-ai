// Test-only XML balance checker: declaration, comments, start, end and self-closing
// tags with double-quoted attributes; one root element. No production file imports it.
const TOKEN =
  /<\?xml[^?]*\?>|<!--[\s\S]*?-->|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<[^>]*>/g;

export function assertWellFormedXml(xml: string): void {
  const stack: string[] = [];
  let roots = 0;
  for (const match of xml.matchAll(TOKEN)) {
    const [token, close, open, , selfClosing] = match;
    if (token.startsWith('<?xml') || token.startsWith('<!--')) continue;
    if (close !== undefined) {
      const top = stack.pop();
      if (top !== close) throw new Error(`unbalanced </${close}> (open: <${top ?? 'none'}>)`);
    } else if (open !== undefined) {
      if (stack.length === 0) roots += 1;
      if (roots > 1) throw new Error(`second root element <${open}>`);
      if (selfClosing !== '/') stack.push(open);
    } else {
      throw new Error(`malformed tag ${token}`);
    }
  }
  if (stack.length > 0) throw new Error(`unclosed <${stack[stack.length - 1] ?? ''}>`);
  if (roots === 0) throw new Error('no root element');
}
