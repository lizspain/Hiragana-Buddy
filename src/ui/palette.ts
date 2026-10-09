// Ink colour picker: big round swatches, one tap to choose.

import { h } from "./dom";

export const INK_COLORS = ["#f28c28", "#e85d9b", "#3e8ede", "#33a167", "#8a5cd6"];

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
