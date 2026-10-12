// Ink colour picker: big round swatches, one tap to choose.

import { h } from "./dom";

// The palette's bright colours (design-export/Hiragana Buddy Palette.png):
// amber, rust, coral, green, cyan, violet. Its light orange (#fdba74) is left
// out: too faint to see on the cream paper.
export const INK_COLORS = ["#d97706", "#c2410c", "#f87171", "#15803d", "#0891b2", "#a78bfa"];

/** A saved colour from before the palette change falls back to the first one. */
export const inkOrDefault = (c: string) => (INK_COLORS.includes(c) ? c : INK_COLORS[0]);

export function inkPalette(current: string, onPick: (color: string) => void): HTMLElement {
  const wrap = h("div", { class: "swatches", role: "radiogroup", "aria-label": "Ink colour", "data-testid": "palette" });
  const select = (c: string) => {
    wrap.querySelectorAll<HTMLElement>(".swatch").forEach((s) => {
      const on = s.dataset.color === c;
      s.classList.toggle("on", on);
      s.setAttribute("aria-checked", String(on));
    });
  };
  for (const c of INK_COLORS) {
    wrap.appendChild(
      h("button", {
        class: "swatch",
        style: `--c:${c}`,
        role: "radio",
        "data-color": c,
        "aria-label": "Ink colour",
        onclick: () => {
          select(c);
          onPick(c);
        },
      }),
    );
  }
  select(current);
  return wrap;
}
