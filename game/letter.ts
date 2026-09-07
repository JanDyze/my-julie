/**
 * The five pieces of the letter.
 *
 * ─────────────────────────────────────────────────────────────────
 *  EDIT THE `text` FIELDS BELOW. This is the whole point of the game.
 *  Each piece is one part of the letter, read in order once all five
 *  are found. Keep them fairly short — they're read on a phone.
 * ─────────────────────────────────────────────────────────────────
 */

export interface LetterPiece {
  id: number;
  /** Shown in the collection tracker before it's found. */
  hint: string;
  text: string;
}

export const LETTER_TITLE = "For Julie";
export const LETTER_SIGNOFF = "— always yours";

export const LETTER_PIECES: LetterPiece[] = [
  {
    id: 1,
    hint: "The first piece",
    text: "PLACEHOLDER — replace me. This is where the letter begins.",
  },
  {
    id: 2,
    hint: "The second piece",
    text: "PLACEHOLDER — replace me. The second part of what I wanted to say.",
  },
  {
    id: 3,
    hint: "The third piece",
    text: "PLACEHOLDER — replace me. The middle, the part that matters most.",
  },
  {
    id: 4,
    hint: "The fourth piece",
    text: "PLACEHOLDER — replace me. Nearly there now.",
  },
  {
    id: 5,
    hint: "The last piece",
    text: "PLACEHOLDER — replace me. And this is how it ends.",
  },
];

export const TOTAL_PIECES = LETTER_PIECES.length;

const STORAGE_KEY = "loot-island-letter";

/** Pieces found so far, persisted so progress survives across sessions. */
export function loadFoundPieces(): number[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (id): id is number => typeof id === "number" && id >= 1 && id <= TOTAL_PIECES,
    );
  } catch {
    return [];
  }
}

export function saveFoundPieces(ids: number[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)].sort()));
  } catch {
    // Private browsing can refuse storage; progress just won't persist.
  }
}

export function resetFoundPieces(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore.
  }
}
