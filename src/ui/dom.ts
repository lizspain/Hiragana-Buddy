// Tiny DOM helpers: no framework, five screens.

import { glyph } from "../data";

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "class") el.className = String(v);
      else if (k === "html") el.innerHTML = String(v);
      else if (k in el && k !== "style" && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]) {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}

/** Element from an SVG/HTML string. */
export function html(markup: string): Element {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild!;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * A kana drawn from the KanjiVG stroke data, so every device shows the
 * textbook letter shape rather than whatever its font does.
 */
export function kanaSvg(k: string, cls = "kana"): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 109 109");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const g = glyph(k);
  for (const s of g?.strokes ?? []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", s.d);
    svg.appendChild(p);
  }
  return svg;
}

/** Big round icon button with an accessible (spoken by screen readers) label. */
export function iconButton(icon: string, label: string, onClick: (e: MouseEvent) => void, cls = ""): HTMLButtonElement {
  return h("button", { class: `icon-btn ${cls}`, "aria-label": label, title: label, onclick: onClick, html: icon });
}

/** Press-and-hold gate for parent-only controls. */
export function holdButton(icon: string, label: string, ms: number, onDone: () => void): HTMLButtonElement {
  const b = h("button", { class: "icon-btn hold-btn", "aria-label": label, title: `${label} (press and hold)`, html: icon });
  b.style.setProperty("--hold-ms", `${ms}ms`);
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    b.classList.remove("holding");
  };
  b.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    b.classList.add("holding");
    timer = window.setTimeout(() => {
      stop();
      onDone();
    }, ms);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
  b.addEventListener("contextmenu", (e) => e.preventDefault());
  // Keyboard users: hold Enter/Space isn't practical, so a long-press on keyboard = 3 quick presses.
  let presses = 0;
  let pressTimer = 0;
  b.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    presses++;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => (presses = 0), 800);
    if (presses >= 3) {
      presses = 0;
      onDone();
    }
  });
  return b;
}

export function stars(n: number, cls = "stars"): HTMLElement {
  const wrap = h("div", { class: cls, role: "img", "aria-label": `${n} star${n === 1 ? "" : "s"}` });
  for (let i = 0; i < 3; i++) wrap.appendChild(html(`<span class="star ${i < n ? "on" : "off"}" style="--i:${i}">${ICON.star}</span>`));
  return wrap;
}

export function modal(content: HTMLElement, onClose?: () => void): { close: () => void } {
  const back = h("div", { class: "modal-back" });
  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, content);
  back.appendChild(box);
  const close = () => {
    back.remove();
    onClose?.();
  };
  back.addEventListener("pointerdown", (e) => {
    if (e.target === back) close();
  });
  document.body.appendChild(back);
  return { close };
}

// ---------- icons (inline SVG, currentColor) ----------

const svg = (body: string, vb = "0 0 48 48") =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  home: svg(`<path d="M7 23 24 8l17 15"/><path d="M12 20v19h9V29h6v10h9V20"/>`),
  back: svg(`<path d="M28 10 14 24l14 14"/>`),
  replay: svg(`<path d="M10 24a14 14 0 1 0 4.5-10.3"/><path d="M13 6v8h8"/>`),
  soundOn: svg(`<path d="M8 19h7l10-8v26l-10-8H8z" fill="currentColor" stroke-width="3"/><path d="M32 17a10 10 0 0 1 0 14M36 12a16 16 0 0 1 0 24"/>`),
  soundOff: svg(`<path d="M8 19h7l10-8v26l-10-8H8z" fill="currentColor" stroke-width="3"/><path d="M33 19l10 10M43 19 33 29"/>`),
  speaker: svg(`<path d="M8 19h7l10-8v26l-10-8H8z" fill="currentColor" stroke-width="3"/><path d="M32 17a10 10 0 0 1 0 14"/>`),
  // Filled gear from the Figma Make mockup.
  gear: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m20 5-1.2 5.3-4.2 1.8-4.6-2.9-4.8 4.8 2.9 4.6L6.3 23 1 24l1 6 5.4.9 1.8 4.3-2.9 4.6 4.8 4.8 4.6-2.9 4.3 1.8 1 5.3h6l1-5.3 4.3-1.8 4.6 2.9 4.8-4.8-2.9-4.6 1.8-4.3L47 30l1-6-5.3-1-1.8-4.3 2.9-4.6L39 9.3l-4.6 2.9-4.3-1.8L29 5Z" fill="currentColor" stroke="#1c1917" stroke-width="1.5" stroke-linejoin="round"/><circle cx="24" cy="27" r="7" fill="#dfbe91" stroke="#1c1917" stroke-width="3"/></svg>`,
  mic: svg(`<rect x="17" y="5" width="14" height="24" rx="7" fill="currentColor"/><path d="M10 22a14 14 0 0 0 28 0M24 36v7M17 43h14"/>`),
  play: svg(`<path d="M16 10v28l22-14z" fill="currentColor"/>`),
  plus: svg(`<path d="M24 10v28M10 24h28"/>`),
  trash: svg(`<path d="M9 13h30M19 13V8h10v5M13 13l2 27h18l2-27"/>`),
  swap: svg(`<path d="M10 17h26l-7-7M38 31H12l7 7"/>`),
  eye: svg(`<path d="M4 24s7-12 20-12 20 12 20 12-7 12-20 12S4 24 4 24z"/><circle cx="24" cy="24" r="5" fill="currentColor"/>`),
  trace: svg(`<path d="M8 36c6-14 12-22 18-22s4 12 14 6" stroke-dasharray="3 6"/><circle cx="8" cy="36" r="4" fill="currentColor"/>`),
  pencil: svg(`<path d="M30 8l10 10-22 22H8V30z"/><path d="M26 12l10 10"/>`),
  wordBubble: svg(
    `<path d="M6 10h36v22H24l-9 8v-8H6z" fill="#fff"/><path d="M29 35 41 23l4 4-12 12h-4z" fill="#ffd27a"/>`,
  ),
  star: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4l6 13 14 1.6-10.5 9.6 3 14L24 35l-12.5 7.2 3-14L4 18.6 18 17z" fill="currentColor" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`,
  download: svg(`<path d="M24 8v22M14 21l10 10 10-10M10 40h28"/>`),
  upload: svg(`<path d="M24 32V10M14 19l10-10 10 10M10 40h28"/>`),
  share: svg(`<path d="M24 6v24M15 15l9-9 9 9"/><path d="M14 22h-4v20h28V22h-4"/>`),
  addSquare: svg(`<rect x="8" y="8" width="32" height="32" rx="8"/><path d="M24 16v16M16 24h16"/>`),
};

/** The mascot: the octopus (art/octopus.webp, cut out from art-source/). */
export function mascot(cls = "mascot"): HTMLImageElement {
  return h("img", { class: cls, src: "art/octopus.webp", alt: "", "aria-hidden": "true", draggable: "false", decoding: "async" });
}
