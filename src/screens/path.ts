// Listen & Match: the set path (docs/LISTEN-MATCH.md "Getting in"). The
// stones, stars, unlocks and arrival animations are the shared stone path
// (stone-path.ts); this adds the sets' kana faces and, above the path, a short
// row of My word stones (the 3 most recently practised words), always open.

import type { Nav, Screen } from "../app";
import { PATH_SETS, pathSetById, wordSetId } from "../match/sets";
import { unlockAudio } from "../ui/audio";
import { h, kanaSvg } from "../ui/dom";
import { getItems, getSettings, matchBestStars } from "../store";
import { stonePath, type PathArrival } from "./stone-path";

export type { PathArrival } from "./stone-path";

/** My word stones shown above the path (decided 2026-11-25). */
const WORD_STONES = 3;

export function pathScreen(nav: Nav, arrival?: PathArrival): Screen {
  return stonePath(
    {
      ids: PATH_SETS.map((s) => s.id),
      face: (id) => kanaSvg(pathSetById(id)!.kana[0]),
      best: matchBestStars,
      unlockAll: getSettings().unlockPath,
      play: (id) => nav.match(id),
      name: (_, i) => `set ${i + 1}`,
      testId: "path",
      home: () => nav.home(),
      top: ({ shown, best, starSlots, register }) => {
        const words = getItems()
          .filter((it) => it.kind === "word" && it.kana.length > 0)
          .slice(0, WORD_STONES);
        if (!words.length) return null;
        return h(
          "section",
          { class: "word-stones", "aria-label": "My words" },
          words.map((it) => {
            const id = wordSetId(it.kana);
            const b = h(
              "button",
              {
                class: "stone word",
                "data-testid": "word-stone",
                "data-set": id,
                "data-open": "true",
                "data-best": String(shown(id)),
                "aria-label": `Play ${it.input || it.kana.join("")}`,
                onclick: () => {
                  unlockAudio();
                  nav.match(id);
                },
              },
              h("span", { class: "stone-face" }, it.kana.slice(0, 3).map((k) => kanaSvg(k))),
              starSlots(shown(id), best(id)),
            );
            register(id, b);
            return b;
          }),
        );
      },
    },
    arrival,
  );
}
