// The page backdrop from the Figma Make mockup: faint wood-grain lines plus a
// few pebble clusters with sprouts. One fixed, static SVG behind every screen,
// so it costs nothing while a child draws. Fainter on the writing screen.

const GRAIN = `
<g class="grain">
  <path d="M-80 102C38 138 73 22 186-15S350 5 405-84"/>
  <path d="M-96 151C45 195 109 67 211 32S361 44 437-58"/>
  <path d="M-94 209C48 248 126 127 226 91S383 100 462-19"/>
  <path d="M1004-48c-31 105 98 122 57 224s62 149 154 117"/>
  <path d="M1060-63c-34 98 83 129 53 225s42 144 135 138"/>
  <path d="M1119-69c-30 87 72 120 55 205s31 129 111 130"/>
  <path d="M-79 867c127-78 196 36 313-31s170 33 264 118"/>
  <path d="M-99 931c143-88 223 26 335-30s168 27 263 115"/>
  <path d="M936 848c80-36 128 56 206 13s130-11 181 55"/>
  <path d="M909 902c91-44 144 48 221 16s126-3 186 66"/>
</g>`;

/** A pebble: rounded blob with outline, lower shade and a highlight. */
function pebble(x: number, y: number, rx: number, ry: number, fill: string, edge: string, rot = 0): string {
  return `<g transform="translate(${x} ${y}) rotate(${rot})">
    <ellipse rx="${rx}" ry="${ry}" cy="3" fill="rgb(120 90 60 / 14%)"/>
    <ellipse rx="${rx}" ry="${ry}" fill="${fill}" stroke="${edge}" stroke-width="2.5"/>
    <ellipse rx="${rx * 0.42}" ry="${ry * 0.22}" cx="${-rx * 0.25}" cy="${-ry * 0.42}" fill="#fff" opacity=".35"/>
  </g>`;
}

function sprout(x: number, y: number, s = 1): string {
  return `<g transform="translate(${x} ${y}) scale(${s})" stroke="#3f6b3a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round">
    <path d="M0 0v-16" fill="none"/>
    <path d="M0-12c-3-9-12-11-16-8 3 7 10 10 16 8z" fill="#7fae5a"/>
    <path d="M0-14c4-9 13-10 17-6-4 7-11 9-17 6z" fill="#93c06a"/>
  </g>`;
}

// Each cluster is its own small SVG pinned to a screen corner, so it shows on
// any screen shape (a single cropped SVG would cut them off on tall phones).
const CLUSTERS: [string, string, string][] = [
  [
    "pebbles-a",
    "0 0 150 80",
    `${pebble(40, 44, 26, 18, "#c9a175", "#7e5a3b", -8)}${pebble(82, 58, 17, 13, "#8fae84", "#4f6e4a", 12)}${pebble(20, 64, 14, 11, "#9fc4cf", "#4f7f8c", 0)}${sprout(110, 56, 1)}`,
  ],
  [
    "pebbles-b",
    "0 0 120 70",
    `${pebble(46, 36, 22, 16, "#a9a29b", "#6b625b", 10)}${pebble(84, 52, 15, 12, "#d8b48c", "#8a6542", -6)}${sprout(20, 50, 0.9)}`,
  ],
  [
    "pebbles-c",
    "0 0 150 80",
    `${sprout(24, 58, 1.05)}${pebble(64, 44, 24, 17, "#6f8f6a", "#3f5a3c", -4)}${pebble(106, 58, 16, 12, "#c9a175", "#7e5a3b", 14)}${pebble(132, 64, 13, 10, "#5f9fae", "#2f6876", 0)}`,
  ],
];

export function installBackdrop(): void {
  if (document.getElementById("backdrop")) return;
  const wrap = document.createElement("div");
  wrap.id = "backdrop";
  wrap.setAttribute("aria-hidden", "true");
  wrap.innerHTML =
    `<svg class="grain-layer" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice" focusable="false">${GRAIN}</svg>` +
    CLUSTERS.map(([cls, vb, body]) => `<svg class="pebbles ${cls}" viewBox="${vb}" focusable="false">${body}</svg>`).join("");
  document.body.prepend(wrap);
}
