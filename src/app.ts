// Screen router. Screens are plain functions that build a DOM tree and may
// return a cleanup. Back (browser/Android) always returns home.

import type { Item } from "./store";
import { chartScreen } from "./screens/chart";
import { doneScreen } from "./screens/done";
import { entryScreen } from "./screens/entry";
import { homeScreen } from "./screens/home";
import { parentScreen } from "./screens/parent";
import { writeScreen } from "./screens/write";

export interface Screen {
  el: HTMLElement;
  destroy?: () => void;
  /** Called after the element is in the document. */
  mounted?: () => void;
}

export interface PracticePlan {
  kind: Item["kind"];
  kana: string[];
  input: string;
  mode: Item["mode"];
}

export interface WordResult {
  plan: PracticePlan;
  score: number;
  stars: 1 | 2 | 3;
  drawings: [number, number][][][];
}

export interface Nav {
  home(): void;
  chart(): void;
  entry(): void;
  write(plan: PracticePlan): void;
  done(result: WordResult): void;
  parent(): void;
}

let current: Screen | null = null;
let root: HTMLElement;

export function initRouter(el: HTMLElement): void {
  root = el;
  window.addEventListener("popstate", () => {
    if (location.hash && location.hash !== "#") return;
    void nav.home();
  });
}

function show(screen: Screen, name: string) {
  current?.destroy?.();
  root.replaceChildren(screen.el);
  current = screen;
  document.body.dataset.screen = name;
  screen.mounted?.();
  window.scrollTo(0, 0);
  if (name === "home") {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  } else if (!location.hash) history.pushState(null, "", "#" + name);
  else history.replaceState(null, "", "#" + name);
}

export const nav: Nav = {
  home: () => show(homeScreen(nav), "home"),
  chart: () => show(chartScreen(nav), "chart"),
  entry: () => show(entryScreen(nav), "entry"),
  write: (plan) => show(writeScreen(nav, plan), "write"),
  done: (result) => show(doneScreen(nav, result), "done"),
  parent: () => show(parentScreen(nav), "parent"),
};
