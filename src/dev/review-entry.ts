// Entry for tools/audio-review.html (dev server only; not part of the build).

import { loadStrokes } from "../data";
import { loadVoice } from "../ui/audio";
import { audioReviewScreen } from "./audio-review";

await Promise.all([loadStrokes(), loadVoice()]);
document.getElementById("app")!.replaceChildren(audioReviewScreen());
