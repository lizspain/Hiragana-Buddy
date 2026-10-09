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
  watch: en("Watch me!"),
  trace: en("Now you trace it!"),
  write: en("Now write it by yourself!"),
  again1: en("Let's watch again!"),
  again2: en("Almost! Watch me."),
  again3: en("Let's try that one again!"),
  dot: en("Start at the green dot!"),
  follow: en("Follow me!"),
  together: en("Let's do it together!"),
  togetherDone: en("We did it together!"),
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

/** Japanese vowel kana for ー, by the vowel of the mora before it. */
export const VOWEL_OF: Record<string, string> = { a: "あ", i: "い", u: "う", e: "え", o: "お" };
