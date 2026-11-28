// Everything the app says aloud. DOM-free so scripts/ can import it to render
// recorded clips. Clips are looked up by their exact text (see ui/audio.ts).

export type Lang = "ja" | "en";

export interface Line {
  text: string;
  lang: Lang;
}

const en = (text: string): Line => ({ text, lang: "en" });
const ja = (text: string): Line => ({ text, lang: "ja" });

export const LINES = {
  watch: en("Follow me!"), // phase 1 opener
  trace: en("Now you trace it!"),
  write: en("Now write it by yourself!"),
  again1: en("Let's watch again!"),
  again2: en("Almost! Watch me."),
  again3: en("Let's try that one again!"),
  dot: en("Start at the green dot!"),
  follow: en("Follow me!"),
  together: en("Let's do it together!"),
  togetherDone: en("We did it together!"),
  movedOn: en("Oops. We'll try that one together another time."),
  // Listen & Match, very first game only: Japanese first, then English. The
  // Japanese line is rendered in the kana voice (scripts/gen-kana-audio.ts).
  matchIntroEn: en("Listen, then tap the one you hear!"),
} satisfies Record<string, Line>;

export type LineId = keyof typeof LINES;

export const PRAISE: Line[] = [ja("じょうず！"), ja("すごい！"), ja("できた！"), en("Great job!"), en("Wonderful!"), en("You did it!"), ja("いいね！")];

/** "Ooh, that's stroke 3! Let's do stroke 2 first." (1-based numbers) */
export const orderLine = (drawn: number, expected: number): Line => en(`Ooh, that's stroke ${drawn}! Let's do stroke ${expected} first.`);

/** Every order-slip line that can occur (kana have at most 4 strokes). */
export function allOrderLines(maxStrokes = 4): Line[] {
  const out: Line[] = [];
  for (let e = 1; e < maxStrokes; e++) for (let d = e + 1; d <= maxStrokes; d++) out.push(orderLine(d, e));
  return out;
}

/**
 * Kana that modern Japanese pronounces exactly like another kana. Their own
 * clips are never played: they borrow the other kana's clip, so the voice
 * can't teach a "wo" or a "dzu" that isn't there, and Listen & Match never
 * puts both in one set.
 */
export const SOUNDS_LIKE: Readonly<Record<string, string>> = { を: "お", ぢ: "じ", づ: "ず" };

/** The kana whose clip plays for `k`. */
export const soundOf = (k: string): string => SOUNDS_LIKE[k] ?? k;

/** Japanese vowel kana for ー, by the vowel of the mora before it. */
export const VOWEL_OF: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };
