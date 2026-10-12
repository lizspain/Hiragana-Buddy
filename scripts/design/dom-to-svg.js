// Runs inside the app page (injected by scripts/design/export.mjs).
// Rebuilds the visible page as an SVG that Figma imports as editable layers:
// boxes → rectangles (fill, border, corner radius, shadows as Figma drop-shadow
// effects), inline icons/kana → vectors, text → text layers, canvases → images.
// Groups are named after aria-labels / test ids / class names.

window.__toFigmaSVG = function toFigmaSVG(title) {
  const W = document.documentElement.clientWidth;
  const H = Math.max(document.documentElement.scrollHeight, innerHeight);
  const ox = scrollX;
  const oy = scrollY;
  const defs = [];
  const used = new Map();
  let fid = 0;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const n = (v) => parseFloat(v) || 0;
  const r1 = (v) => Math.round(v * 10) / 10;
  const visibleColor = (c) => c && c !== "transparent" && !/rgba\(.*,\s*0\)$/.test(c);

  function nameOf(el) {
    let s =
      el.getAttribute?.("aria-label") ||
      el.dataset?.testid ||
      (typeof el.className === "string" && el.className.split(" ")[0]) ||
      el.tagName.toLowerCase();
    s = s.replace(/[^\w぀-ヿ-]+/g, "-").replace(/^-|-$/g, "") || "layer";
    const c = (used.get(s) || 0) + 1;
    used.set(s, c);
    return c > 1 ? `${s}-${c}` : s;
  }

  function parseColor(c) {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return { r: 0, g: 0, b: 0, a: 1 };
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0] / 255, g: p[1] / 255, b: p[2] / 255, a: p.length > 3 ? p[3] : 1 };
  }

  function radiusOf(cs, w, h) {
    const v = cs.borderTopLeftRadius;
    const r = v.endsWith("%") ? (n(v) / 100) * Math.min(w, h) : n(v);
    return Math.min(r, w / 2, h / 2);
  }

  /** box-shadow → Figma-style filter (re-imported as Drop shadow effects) + inset rings as strokes. */
  function shadows(cs, x, y, w, h) {
    const list = cs.boxShadow === "none" ? [] : cs.boxShadow.split(/,(?![^(]*\))/);
    const drops = [];
    const rings = [];
    for (const s of list) {
      const color = s.match(/rgba?\([^)]*\)/)?.[0];
      const nums = s.replace(/rgba?\([^)]*\)/, "").match(/-?[\d.]+px/g)?.map(n) ?? [];
      const [dx = 0, dy = 0, blur = 0, spread = 0] = nums;
      if (!color || !visibleColor(color)) continue;
      if (/inset/.test(s)) rings.push({ color, spread });
      else drops.push({ color: parseColor(color), dx, dy, blur, spread });
    }
    if (!drops.length) return { filter: "", rings };
    const id = `shadow${++fid}`;
    const pad = Math.max(...drops.map((d) => d.blur * 2 + Math.abs(d.dx) + Math.abs(d.dy) + d.spread)) + 4;
    let body = `<feFlood flood-opacity="0" result="BackgroundImageFix"/>`;
    drops.forEach((d, i) => {
      body +=
        `<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>` +
        (d.spread ? `<feMorphology radius="${d.spread}" operator="dilate" in="SourceAlpha" result="spread${i}"/>` : "") +
        `<feOffset dx="${d.dx}" dy="${d.dy}"/>` +
        (d.blur ? `<feGaussianBlur stdDeviation="${d.blur / 2}"/>` : "") +
        `<feColorMatrix type="matrix" values="0 0 0 0 ${d.color.r.toFixed(3)} 0 0 0 0 ${d.color.g.toFixed(3)} 0 0 0 0 ${d.color.b.toFixed(3)} 0 0 0 ${d.color.a} 0"/>` +
        `<feBlend mode="normal" in2="${i ? `effect${i}_dropShadow` : "BackgroundImageFix"}" result="effect${i + 1}_dropShadow"/>`;
    });
    body += `<feBlend mode="normal" in="SourceGraphic" in2="effect${drops.length}_dropShadow" result="shape"/>`;
    defs.push(
      `<filter id="${id}" x="${r1(x - pad)}" y="${r1(y - pad)}" width="${r1(w + pad * 2)}" height="${r1(h + pad * 2)}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">${body}</filter>`,
    );
    return { filter: ` filter="url(#${id})"`, rings };
  }

  /** Inline SVG → group of vectors with computed styles baked in (CSS doesn't travel). */
  function svgEl(el, x, y, w, h) {
    const vb = el.viewBox?.baseVal;
    const vw = vb?.width || w;
    const vh = vb?.height || h;
    const s = Math.min(w / vw, h / vh);
    const tx = x + (w - vw * s) / 2 - (vb?.x || 0) * s;
    const ty = y + (h - vh * s) / 2 - (vb?.y || 0) * s;
    const clone = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll("*")];
    const dst = [clone, ...clone.querySelectorAll("*")];
    src.forEach((o, i) => {
      const cs = getComputedStyle(o);
      const d = dst[i];
      d.removeAttribute("class");
      d.removeAttribute("style");
      for (const p of ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "opacity"]) {
        let v = cs.getPropertyValue(p);
        if (!v || v === "normal") continue;
        if (p === "stroke-dasharray" && v === "none") continue;
        if (p === "opacity" && v === "1") continue;
        d.setAttribute(p, v);
      }
    });
    const inner = [...clone.childNodes].map((c) => (c.outerHTML ?? "")).join("");
    return `<g id="${esc(nameOf(el))}" transform="translate(${r1(tx)} ${r1(ty)}) scale(${+s.toFixed(4)})">${inner}</g>`;
  }

  const measure = document.createElement("canvas").getContext("2d");
  function textLines(node, cs) {
    const out = [];
    const text = node.textContent;
    const range = document.createRange();
    let line = null;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rc = range.getClientRects()[0];
      if (!rc) continue;
      if (!line || Math.abs(rc.top - line.top) > rc.height / 2) {
        line = { top: rc.top, left: rc.left, height: rc.height, text: "" };
        out.push(line);
      }
      line.text += text[i];
    }
    measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = measure.measureText("Hg");
    const asc = m.fontBoundingBoxAscent || n(cs.fontSize) * 0.9;
    const desc = m.fontBoundingBoxDescent || n(cs.fontSize) * 0.25;
    return out
      .map((l) => ({ ...l, text: l.text.replace(/\s+$/, "") }))
      .filter((l) => l.text.trim())
      .map((l) => {
        const baseline = l.top + (asc * l.height) / (asc + desc);
        return textTag(l.text.replace(/^\s+/, ""), l.left + ox, baseline + oy, cs, cs.color);
      });
  }

  function textTag(t, x, y, cs, color) {
    const ls = cs.letterSpacing === "normal" ? "" : ` letter-spacing="${n(cs.letterSpacing)}"`;
    const fam = cs.fontFamily.replace(/"/g, "'");
    return `<text x="${r1(x)}" y="${r1(y)}" font-family="${esc(fam)}" font-size="${n(cs.fontSize)}" font-weight="${cs.fontWeight}" fill="${color}"${ls} xml:space="preserve">${esc(t)}</text>`;
  }

  function canvasImage(el, x, y, w, h) {
    // Skip blank layers (e.g. an idle effects canvas).
    const probe = document.createElement("canvas");
    probe.width = probe.height = 48;
    const pc = probe.getContext("2d");
    pc.drawImage(el, 0, 0, 48, 48);
    const a = pc.getImageData(0, 0, 48, 48).data;
    let any = false;
    for (let i = 3; i < a.length && !any; i += 4) any = a[i] > 0;
    if (!any) return "";
    return `<image id="${esc(nameOf(el))}" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" preserveAspectRatio="none" href="${el.toDataURL("image/png")}"/>`;
  }

  function walk(el) {
    if (el.nodeType === 3) return "";
    if (el.nodeType !== 1 || el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.id === "boot") return "";
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || n(cs.opacity) === 0) return "";
    const rc = el.getBoundingClientRect();
    if (rc.width === 0 && rc.height === 0 && el.tagName !== "BODY") return "";
    const x = rc.left + ox;
    const y = rc.top + oy;
    const w = rc.width;
    const h = rc.height;

    if (el instanceof SVGSVGElement) return svgEl(el, x, y, w, h);
    if (el.tagName === "CANVAS") return canvasImage(el, x, y, w, h);

    let body = "";
    const bg = cs.backgroundColor;
    const sides = ["Top", "Right", "Bottom", "Left"].map((s) => ({
      s,
      w: cs[`border${s}Style`] === "none" ? 0 : n(cs[`border${s}Width`]),
      c: cs[`border${s}Color`],
    }));
    const uniform = sides.every((d) => d.w === sides[0].w && d.c === sides[0].c);
    const border = uniform && sides[0].w && visibleColor(sides[0].c);
    // Single-side borders (dividers) become lines.
    let lines = "";
    if (!uniform) {
      for (const d of sides) {
        if (!d.w || !visibleColor(d.c)) continue;
        const h2 = d.w / 2;
        const [x1, y1, x2, y2] =
          d.s === "Top" ? [x, y + h2, x + w, y + h2] : d.s === "Bottom" ? [x, y + h - h2, x + w, y + h - h2] : d.s === "Left" ? [x + h2, y, x + h2, y + h] : [x + w - h2, y, x + w - h2, y + h];
        lines += `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${d.c}" stroke-width="${d.w}"/>`;
      }
    }
    const rad = radiusOf(cs, w, h);
    const { filter, rings } = shadows(cs, x, y, w, h);
    if (visibleColor(bg) || border || filter) {
      const bw = border ? n(cs.borderTopWidth) : 0;
      const stroke = border ? ` stroke="${cs.borderTopColor}" stroke-width="${bw}"` : "";
      // Stroke drawn inside the box, as CSS borders are.
      body += `<rect x="${r1(x + bw / 2)}" y="${r1(y + bw / 2)}" width="${r1(w - bw)}" height="${r1(h - bw)}" rx="${r1(Math.max(0, rad - bw / 2))}" fill="${visibleColor(bg) ? bg : "none"}"${stroke}${filter}/>`;
    }
    body += lines;
    for (const ring of rings) {
      const s = ring.spread;
      body += `<rect x="${r1(x + s / 2)}" y="${r1(y + s / 2)}" width="${r1(w - s)}" height="${r1(h - s)}" rx="${r1(Math.max(0, rad - s / 2))}" fill="none" stroke="${ring.color}" stroke-width="${s}"/>`;
    }

    if (el.tagName === "INPUT") {
      const val = el.value || el.placeholder;
      if (val) {
        const color = el.value ? cs.color : "rgb(170, 155, 145)";
        measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const m = measure.measureText("Hg");
        const fs = n(cs.fontSize);
        const asc = m.fontBoundingBoxAscent || fs * 0.9;
        const desc = m.fontBoundingBoxDescent || fs * 0.25;
        const top = y + n(cs.borderTopWidth) + n(cs.paddingTop);
        const inner = h - n(cs.borderTopWidth) * 2 - n(cs.paddingTop) - n(cs.paddingBottom);
        body += textTag(val, x + n(cs.borderLeftWidth) + n(cs.paddingLeft), top + (inner - asc - desc) / 2 + asc, cs, color);
      }
    }

    for (const c of el.childNodes) {
      if (c.nodeType === 3 && c.textContent.trim()) body += textLines(c, cs).join("");
      else body += walk(c);
    }
    if (!body) return "";
    const op = n(cs.opacity) < 1 ? ` opacity="${cs.opacity}"` : "";
    return `<g id="${esc(nameOf(el))}"${op}>${body}</g>`;
  }

  // Page background (the app's two soft radial glows on cream).
  const bgColor = getComputedStyle(document.body).backgroundColor;
  defs.push(
    `<radialGradient id="glowA" cx="${W * 0.15}" cy="0" r="${Math.max(W, H) * 0.45}" gradientUnits="userSpaceOnUse"><stop stop-color="#fff3e2"/><stop offset="1" stop-color="#fff3e2" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="glowB" cx="${W}" cy="${H}" r="${Math.max(W, H) * 0.4}" gradientUnits="userSpaceOnUse"><stop stop-color="#ffeaf0"/><stop offset="1" stop-color="#ffeaf0" stop-opacity="0"/></radialGradient>`,
  );
  const background =
    `<g id="background"><rect width="${W}" height="${H}" fill="${bgColor}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#glowA)"/><rect width="${W}" height="${H}" fill="url(#glowB)"/></g>`;

  const content = [...document.body.children].map(walk).join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none">` +
    `<title>${esc(title)}</title><defs>${defs.join("")}</defs>${background}${content}</svg>`
  );
};
