import type { Nav, Screen } from "../app";
import { charts } from "../data";
import { sayKana, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg } from "../ui/dom";

type Page = "basic" | "voiced" | "small";
const PAGE_ICON: Record<Page, string> = { basic: "あ", voiced: "が", small: "ゃ" };

/** The tappable kana chart, used for single-letter practice and the tile editor. */
export function kanaChart(onPick: (k: string) => void, opts: { withLongMark?: boolean; start?: Page } = {}): HTMLElement {
  let page: Page = opts.start ?? "basic";
  const grid = h("div", { class: "chart-grid" });
  const tabs = h("div", { class: "chart-tabs", role: "tablist" });

  // Tabs are built once; switching only moves the "on" class, so the colour can fade across.
  tabs.append(
    ...(Object.keys(PAGE_ICON) as Page[]).map((p) =>
      h(
        "button",
        {
          class: "chart-tab",
          role: "tab",
          "aria-label": p,
          "data-page": p,
          onclick: () => {
            page = p;
            render();
          },
        },
        kanaSvg(PAGE_ICON[p]),
      ),
    ),
  );

  function render() {
    tabs.querySelectorAll<HTMLElement>(".chart-tab").forEach((t) => {
      const on = t.dataset.page === page;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", String(on));
    });
    const rows = charts[page].map((r) => [...r]);
    if (page === "small" && opts.withLongMark !== false) rows.push(["ー", null, null, null, null]);
    grid.replaceChildren(
      ...rows.flat().map((k) =>
        k
          ? h(
              "button",
              {
                class: "chart-cell",
                "data-quiet": "", // it says its kana
                "aria-label": k,
                "data-kana": k,
                onclick: () => {
                  unlockAudio();
                  sayKana(k);
                  onPick(k);
                },
              },
              kanaSvg(k),
            )
          : h("span", { class: "chart-cell empty" }),
      ),
    );
  }
  render();
  return h("div", { class: "chart" }, tabs, grid);
}

export function chartScreen(nav: Nav): Screen {
  let picked = false;
  const el = h(
    "div",
    { class: "screen chart-screen" },
    h("header", { class: "topbar" }, iconButton(ICON.home, "Home", () => nav.home(), "home")),
    kanaChart(
      (k) => {
        if (picked) return;
        picked = true;
        // Let the sound play a beat before the writing screen starts talking.
        setTimeout(() => nav.write({ kind: "kana", kana: [k], input: k, mode: "chart" }), 450);
      },
      { withLongMark: false },
    ),
  );
  return { el };
}
