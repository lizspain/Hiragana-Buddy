import type { Nav, Screen } from "../app";
import { charts, speakText } from "../data";
import { say, unlockAudio } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg } from "../ui/dom";

type Page = "basic" | "voiced" | "small";
const PAGE_ICON: Record<Page, string> = { basic: "あ", voiced: "が", small: "ゃ" };

/** The tappable kana chart, used for single-letter practice and the tile editor. */
export function kanaChart(onPick: (k: string) => void, opts: { withLongMark?: boolean; start?: Page } = {}): HTMLElement {
  let page: Page = opts.start ?? "basic";
  const grid = h("div", { class: "chart-grid" });
  const tabs = h("div", { class: "chart-tabs", role: "tablist" });

  function render() {
    tabs.replaceChildren(
      ...(Object.keys(PAGE_ICON) as Page[]).map((p) =>
        h(
          "button",
          {
            class: `chart-tab${p === page ? " on" : ""}`,
            role: "tab",
            "aria-selected": String(p === page),
            "aria-label": p,
            onclick: () => {
              page = p;
              render();
            },
          },
          kanaSvg(PAGE_ICON[p]),
        ),
      ),
    );
    const rows = charts[page].map((r) => [...r]);
    if (page === "small" && opts.withLongMark !== false) rows.push(["ー", null, null, null, null]);
    grid.replaceChildren(
      ...rows.flat().map((k) =>
        k
          ? h(
              "button",
              {
                class: "chart-cell",
                "aria-label": k,
                "data-kana": k,
                onclick: () => {
                  unlockAudio();
                  say(speakText(k));
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
    h("header", { class: "topbar" }, iconButton(ICON.back, "Back", () => nav.home(), "home")),
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
