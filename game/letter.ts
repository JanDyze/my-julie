/**
 * The five pieces of the letter — the reason this game exists.
 *
 * The words are his, split at natural turns. `hint` is what shows in the
 * tracker and in the "you found a piece" modal, so keep those evocative
 * without giving the piece away.
 */

export interface LetterPiece {
  id: number;
  /** Shown when the piece is found, before the whole letter is readable. */
  hint: string;
  text: string;
}

export const LETTER_TITLE = "Happy 3rd Month";
export const LETTER_SIGNOFF = "— Dyze";

export const LETTER_PIECES: LetterPiece[] = [
  {
    id: 1,
    hint: "How it starts",
    text: `Hey Baby? Beh? Bih? Love? Honey? Mahal? Bibi? Sweetheart?

We have not established that one but I know we'll figure it out haha. Happy 3rd month to our relationship as officially boyfriend and girlfriend.

I can't believe how quickly time passes and slowly at the same time. But I'm loving every second that we spend together - mapawork man yan, therapy, pagkain, panonood, kwentuhan, skin care at higit sa lahat ang ating pagbabasa at pananalangin together.`,
  },
  {
    id: 2,
    hint: "In case you didn't know",
    text: `Alam mo, mahal kita. At kung di mo pa rin alam, ayan, mahal kita. At patuloy kitang mamahalin at sana mahalin mo rin ako at patuloy kang mag extend ng grace sakin for being not the best boyfriend there is but I'm trying (di ako sadboy xD). I know I have many shortcomings and inconsistencies and I have no excuses. But I will keep on learning and keep on trying to make up and be the better lover for you.`,
  },
  {
    id: 3,
    hint: "Why I'm proud of you",
    text: `I am so so so proud of you. Sobrang nakakamangha ka. Sobrang strong mo. You're the strongest woman that I have ever met and I kid you not. How you've gone through the accident, operation, and now the recovery. With a strong mindset and spirit and emotional stability, bruh!! Nakakainlove lalo!! I will be with you throughout your seasons.`,
  },
  {
    id: 4,
    hint: "The things I love",
    text: `You never lost your beautiful smile and nakakahawang laugh. Your cute reactions on things is still the best. Your beautiful face kahit ilang pimples pa ang tumubo dyan, you are still beautiful to me. Your mataray at tampuhin attitude that I find really cute pati na rin ang iyong pagiging iyakin hahaha. Your love for your fam and friends and church and those you disciple. And your desire to keep on knowing God and reading His word. I love you for all those!!

May our relationship remain healthy and above all, Godly. May we both continue to grow in Christ - becoming more like Him and love Him more and more. And malay mo, one day our lives would be a documentary din... Of being a great model of a Christ-like relationship for the next and next generations - or even (god-willingly) our children...`,
  },
  {
    id: 5,
    hint: "A promise",
    text: `I still sometimes wish that I could take all your pain instead of you experiencing them, basta sayo na headache ko charot. Pero seriously, it hurts when i see you in pain - nasanay lang ako sa sigaw at iyak mo pero i still dont want you to be in that situation. I don't want you to get hurt but for now, My Ja, please keep on being strong for we both know na kailangan mo munang dumaan sa pain for now to recover.

And one day, when all of those pains are just memories from the past. I'll try my best to give you this promise - na susulitin natin itong gift of life from God!! Mahal kita, at higit pa ay mahal ka ni Hesus!!

P.S. Sorry that I did not come over today. Bawi ako sa ibang madaming araws to come, I love you!!`,
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
