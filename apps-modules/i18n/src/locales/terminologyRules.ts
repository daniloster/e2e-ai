// Pure copy style checkers (ARCHITECTURE.md §5 "Copy style"), shared by the main and site terminology suites.
import type { Catalog, Locale } from '../types';

/** The product name: never translated, always written exactly like this. */
export const PRODUCT_NAME = 'Pocket Notes';

// Removes every {name} placeholder.
export function stripPlaceholders(value: string): string {
  return value.replace(/\{\w+\}/g, '');
}

// American spellings the en-GB catalogs must not use (colour, favourite, centre ...).
const AMERICAN =
  /\b(colors?|colored|favorites?|centers?|centered|canceled|canceling|gray|behaviors?|analyz(e|ed|es|ing)|customiz(e|ed|es|ing)|organiz(e|ed|es|ing))\b/i;

/** True when an en-GB value uses an American spelling. */
export function americanSpelling(value: string): boolean {
  return AMERICAN.test(stripPlaceholders(value));
}

/** The product name in any casing, with any spacing between its words (built from PRODUCT_NAME). */
const PRODUCT_NAME_PATTERN = new RegExp(
  PRODUCT_NAME.split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s*'),
  'gi',
);

/** True when the value names the product in any other casing or spacing ("pocket notes", "PocketNotes"). */
export function misspelledProductName(value: string): boolean {
  const matches = stripPlaceholders(value).match(PRODUCT_NAME_PATTERN) ?? [];
  return matches.some((match) => match !== PRODUCT_NAME);
}

export const MAX_BUTTON_CODE_POINTS = 24;

/** Leading articles a button may not start with, per catalog. */
export const ARTICLE: Readonly<Record<Locale, RegExp>> = {
  'en-GB': /^(The|A|An) /i,
  es: /^(El|La|Los|Las|Un|Una) /i,
  'pt-BR': /^(O|A|Os|As|Um|Uma) /i,
};

// One line per key that is missing, longer than MAX_BUTTON_CODE_POINTS code points, or starts with an article.
export function buttonShapeOffenders(
  locale: Locale,
  catalog: Catalog,
  keys: readonly string[],
): string[] {
  return keys.flatMap((key) => {
    const value = catalog[key];
    if (value === undefined) return [`${key}: missing`];
    const length = Array.from(value).length;
    return length > MAX_BUTTON_CODE_POINTS || ARTICLE[locale].test(value)
      ? [`${key} (${length}): ${value}`]
      : [];
  });
}
