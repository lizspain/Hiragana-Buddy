// Grown-ups' corner (behind press-and-hold): settings, scores over time,
// letters to revisit, backup/restore, credits.

import type { Nav, Screen } from "../app";
import { clipCount, hasJapaneseVoice, kanaVoiceCredit, setSoundEnabled, voiceCredit } from "../ui/audio";
import { h, ICON, iconButton, kanaSvg } from "../ui/dom";
import { currentProfile, deleteItem, exportBackup, getItems, getKanaProgress, getMatchResults, getSettings, importBackup, resetMatchProgress, saveSettings, type Item, type Settings } from "../store";
import { topMixUps } from "../match/progress";
import { drawingCanvas } from "./done";

export function parentScreen(nav: Nav): Screen {
  const body = h("main", { class: "parent-body" });
  const el = h(
    "div",
    { class: "screen parent" },
    h("header", { class: "topbar" }, iconButton(ICON.back, "Back", () => nav.home(), "home"), h("h2", null, "Settings")),
    body,
  );

  function toggle(key: keyof Settings, label: string, help: string) {
    const s = getSettings();
    const box = h("input", {
      type: "checkbox",
      checked: Boolean(s[key]),
      onchange: () => {
        void saveSettings({ [key]: box.checked } as Partial<Settings>);
        if (key === "sound") setSoundEnabled(box.checked);
      },
    });
    return h("label", { class: "setting" }, box, h("span", null, h("b", null, label), h("small", null, help)));
  }

  function render() {
    const items = getItems();
    body.replaceChildren(
      h(
        "section",
        { class: "card" },
        h("h3", null, "Settings"),
        toggle("sound", "Sound and voice", "Chimes and spoken prompts. Turn off for classrooms."),
        toggle("skipPhase1WhenMastered", "Skip “watch” for known letters", "After a 3-star letter, start it at the tracing step."),
        toggle("matchGame", "Try Listen & Match", "Preview the sound game on the home screen: hear a letter, tap its tile."),
        toggle("expandLongVowel", "Spell ー as a vowel", "じぇーむず becomes じぇえむず for new words."),
        voiceStatus(),
      ),
      ...(getSettings().matchGame ? [matchCard()] : []),
      h("section", { class: "card" }, h("h3", null, "Practice history"), items.length ? historyList(items) : h("p", null, "Nothing practised yet.")),
      ...weakest(items),
      h(
        "section",
        { class: "card" },
        h("h3", null, "Backup"),
        h("p", null, "Everything stays on this device. Save a backup file to keep it safe or move it to another device."),
        h(
          "div",
          { class: "row-btns" },
          h("button", { class: "pill-btn", onclick: download }, h("span", { html: ICON.download }), "Save a backup"),
          h("button", { class: "pill-btn soft", onclick: restore }, h("span", { html: ICON.upload }), "Restore"),
        ),
      ),
      h(
        "section",
        { class: "card about" },
        h("h3", null, "About"),
        h("p", null, "Hiragana Buddy. Free, no ads, no accounts. Nothing is sent anywhere."),
        h("p", null, "Stroke order data: KanjiVG, © Ulrich Apel, CC BY-SA 3.0."),
        letterSoundsCredit(),
        h("p", null, "Romaji conversion: WanaKana (MIT)."),
        h("p", null, "Fonts: Nunito and Klee One, SIL Open Font License 1.1."),
        voiceCredit() ? h("p", null, voiceCredit()!) : null,
        h("p", null, "Name spellings are a seed list; check them with a Japanese speaker."),
      ),
    );
  }

  /** Listen & Match: open the whole path, the sounds most often mixed up, start over. */
  function matchCard() {
    const mix = topMixUps([...getKanaProgress()], currentProfile());
    const games = getMatchResults().filter((r) => r.profileId === currentProfile()).length;
    return h(
      "section",
      { class: "card", "data-testid": "match-card" },
      h("h3", null, "Listen & Match"),
      toggle("unlockPath", "Unlock whole path", "Open every stone now, for a child who is stuck or already knows these sounds. Turning it off closes stones not yet earned; stars are kept."),
      h("h4", null, "Sounds mixed up most"),
      mix.length
        ? h(
            "ul",
            { class: "mixups", "data-testid": "mixups" },
            mix.map((m) =>
              h(
                "li",
                null,
                h("span", { class: "mix-kana" }, kanaSvg(m.heard)),
                h("span", { class: "mix-and", "aria-hidden": "true" }, "↔"),
                h("span", { class: "mix-kana" }, kanaSvg(m.tapped)),
                h("small", null, `${m.heard} and ${m.tapped}: mixed up ${m.count} times`),
              ),
            ),
          )
        : h("p", null, games ? "No sounds mixed up more than once yet." : "No games played yet."),
      games
        ? h(
            "div",
            { class: "row-btns" },
            h(
              "button",
              {
                class: "pill-btn soft",
                onclick: async () => {
                  if (!confirm("Start Listen & Match over? This clears every stone's stars and the mixed-up sounds on this device. It can't be undone (a backup file keeps a copy).")) return;
                  await resetMatchProgress();
                  render();
                },
              },
              h("span", { html: ICON.replay }),
              "Reset set progress",
            ),
          )
        : null,
    );
  }

  /**
   * Whose voice says the letters, from the kana clips' manifest. VOICEVOX's
   * terms require "VOICEVOX:四国めたん" while those clips ship, so that credit
   * links to VOICEVOX and the voice terms. A recorded voice is credited as given.
   */
  function letterSoundsCredit() {
    const voice = kanaVoiceCredit();
    if (!voice) return null;
    const p = h("p", { "data-testid": "kana-voice-credit" }, "Letter sounds: ");
    if (voice.startsWith("VOICEVOX")) {
      p.append(
        h("a", { href: "https://voicevox.hiroshiba.jp/", target: "_blank", rel: "noopener" }, voice),
        " (",
        h("a", { href: "https://zunko.jp/con_ongen_kiyaku.html", target: "_blank", rel: "noopener" }, "voice terms"),
        ").",
      );
    } else p.append(voice, ".");
    return p;
  }

  /** Only speaks up when letter sounds would be silent; otherwise there's nothing a grown-up needs to know. */
  function voiceStatus() {
    if (clipCount() || hasJapaneseVoice()) return null;
    return h(
      "p",
      { class: "voice-status" },
      "This device has no Japanese voice, so letter sounds are silent. Add the Japanese language pack (with speech) in system settings, or use a phone or tablet.",
    );
  }

  function historyList(items: Item[]) {
    return h(
      "ul",
      { class: "history" },
      items.map((it) => {
        const scores = it.sessions.map((s) => s.score);
        const last = it.sessions[it.sessions.length - 1];
        return h(
          "li",
          null,
          h("div", { class: "h-kana" }, it.kana.map((k) => kanaSvg(k))),
          h(
            "div",
            { class: "h-info" },
            h("b", null, it.input || it.kana.join("")),
            h("small", null, `${it.sessions.length} time${it.sessions.length === 1 ? "" : "s"} · last ${last?.score ?? "–"} · best ${Math.max(...scores)}`),
            sparkline(scores),
          ),
          last ? h("div", { class: "h-draw" }, last.drawing.slice(0, 4).map((d) => drawingCanvas(d, getSettings().inkColor, "mini-letter"))) : null,
          iconButton(
            ICON.trash,
            "Delete",
            async () => {
              if (!confirm(`Delete “${it.input || it.kana.join("")}” and its history?`)) return;
              await deleteItem(it.id);
              render();
            },
            "small soft",
          ),
        );
      }),
    );
  }

  function weakest(items: Item[]) {
    const by = new Map<string, number[]>();
    for (const it of items) {
      const last = it.sessions[it.sessions.length - 1];
      for (const p of last?.perKana ?? []) by.set(p.kana, [...(by.get(p.kana) ?? []), p.score]);
    }
    const list = [...by.entries()]
      .map(([k, s]) => ({ k, avg: Math.round(s.reduce((a, b) => a + b, 0) / s.length) }))
      .filter((x) => x.avg < 80)
      .sort((a, b) => a.avg - b.avg)
      .slice(0, 8);
    if (!list.length) return [];
    return [
      h(
        "section",
        { class: "card" },
        h("h3", null, "Letters to revisit"),
        h(
          "div",
          { class: "weak" },
          list.map((x) =>
            h(
              "button",
              { class: "weak-kana", onclick: () => nav.write({ kind: "kana", kana: [x.k], input: x.k, mode: "chart" }) },
              kanaSvg(x.k),
              h("small", null, String(x.avg)),
            ),
          ),
        ),
      ),
    ];
  }

  function download() {
    const blob = new Blob([exportBackup()], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `hiragana-buddy-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function restore() {
    const f = h("input", { type: "file", accept: "application/json,.json" });
    f.addEventListener("change", async () => {
      const file = f.files?.[0];
      if (!file) return;
      try {
        const n = await importBackup(await file.text());
        setSoundEnabled(getSettings().sound);
        alert(`Restored ${n} word${n === 1 ? "" : "s"}.`);
        render();
      } catch {
        alert("That file isn't a Hiragana Buddy backup.");
      }
    });
    f.click();
  }

  render();
  return { el };
}

function sparkline(scores: number[]): SVGSVGElement | HTMLElement {
  if (scores.length < 2) return h("span");
  const w = 120, hgt = 32;
  const pts = scores.map((s, i) => `${((i / (scores.length - 1)) * (w - 6) + 3).toFixed(1)},${(hgt - 3 - (s / 100) * (hgt - 6)).toFixed(1)}`);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  svg.setAttribute("class", "spark");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Scores: ${scores.join(", ")}`);
  svg.innerHTML = `<line x1="0" x2="${w}" y1="${hgt - 3 - 0.8 * (hgt - 6)}" y2="${hgt - 3 - 0.8 * (hgt - 6)}" class="spark-goal"/><polyline points="${pts.join(" ")}"/><circle cx="${pts.at(-1)!.split(",")[0]}" cy="${pts.at(-1)!.split(",")[1]}" r="3"/>`;
  return svg;
}
