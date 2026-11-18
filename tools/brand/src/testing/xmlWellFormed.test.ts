import { describe, expect, it } from 'vitest';

import { assertWellFormedXml } from './xmlWellFormed';

describe('assertWellFormedXml', () => {
  it('accepts a declaration, a comment and balanced tags', () => {
    expect(() =>
      assertWellFormedXml('<?xml version="1.0"?>\n<!-- hi --><a x="1"><b/><c></c></a>\n'),
    ).not.toThrow();
  });

  it('rejects unbalanced tags, unquoted attributes and two roots', () => {
    expect(() => assertWellFormedXml('<a><b></a>')).toThrow(/unbalanced/);
    expect(() => assertWellFormedXml('<a x=1/>')).toThrow(/malformed/);
    expect(() => assertWellFormedXml('<a/><b/>')).toThrow(/second root/);
  });
});
