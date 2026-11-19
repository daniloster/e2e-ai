// Searching notes: which notes match what the person typed. Pure (shared by the app and the website).

/** The fields a note can be found by. */
export interface Searchable {
  title: string;
  description?: string | null;
}

/** Lower case, accents removed and spaces collapsed, so "Café" matches "cafe" and "CAFÉ". */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the query appears in the note's title or description (an empty query matches every note). */
export function matchesSearch(note: Searchable, query: string): boolean {
  const q = normalizeForSearch(query);
  if (!q) return true;
  return normalizeForSearch(note.title).includes(q) || normalizeForSearch(note.description ?? '').includes(q);
}

/** The notes that match the query, in their original order. */
export function searchNotes<T extends Searchable>(notes: readonly T[], query: string): T[] {
  return notes.filter((note) => matchesSearch(note, query));
}
