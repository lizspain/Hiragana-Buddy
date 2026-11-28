// Look & Write: the stage path (docs/VOCAB-SPELLING-DESIGN.md "Getting in",
// "Unlocking"). 1A → 1B → 2A → 2B, each stone showing its first word's
// picture and the best stars earned. 1A is open from the start; a stage opens
// when the one before has a best of 3 stars, or when a grown-up unlocks the
// whole path. Independent of Listen & Match. The stones, mascot and arrival
// animations are the shared stone path.

import "../vocab/vocab.css";
import type { Nav, Screen } from "../app";
import { getSettings, vocabBestStars } from "../store";
import { h } from "../ui/dom";
import { stageById, VOCAB_STAGES } from "../vocab/stages";
import { stonePath, type PathArrival } from "./stone-path";
import { pictureUrl } from "./vocab";

export function vocabPathScreen(nav: Nav, arrival?: PathArrival): Screen {
  return stonePath(
    {
      ids: VOCAB_STAGES.map((s) => s.id),
      face: (id) => h("img", { class: "stone-picture", src: pictureUrl(stageById(id)!.words[0].senses[0]), alt: "", draggable: "false" }),
      best: vocabBestStars,
      unlockAll: getSettings().vocabUnlockPath,
      play: (id) => nav.vocab(id),
      name: (id) => `stage ${id}`,
      testId: "vocab-path",
      home: () => nav.home(),
    },
    arrival,
  );
}
