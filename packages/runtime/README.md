# SVG Animator Runtime

This private workspace package is the dependency-free SVG Animator v1 player. The package name is intentionally non-public until product naming is finalized; the TypeScript API, `RuntimeBundleV1`, and `SVGAnimatorRuntime` browser global are stable v1 contracts.

```ts
import { createPlayer } from "@svg-animator/runtime-private";
import bundle from "./animation.json";

const player = createPlayer("#artwork", bundle);
player.on("marker", ({ marker }) => console.log(marker.name));
player.play();
```

Browser scripts expose the same API on `SVGAnimatorRuntime`. Players mount paused unless `autoPlay` is requested. Generated Animated SVG requests autoplay but honors `prefers-reduced-motion`; explicit `play()` remains available.

An Embedded Animation SVG carries its matching bundle as inert JSON without duplicating the player. Mount one with a shared runtime:

```ts
import { createEmbeddedPlayer } from "@svg-animator/runtime-private";

const player = createEmbeddedPlayer("#artwork");
player.play();
```

See the repository runtime documentation for external assets, events, compatibility, CSP, and embedding guidance.

## Action composition (runtime 1.1)

Bundle format v1 supports the additive `composition.action-windows-v1` capability. A compiled channel may carry ordered, nonoverlapping `actionWindows`, each with a start, exclusive end and same-channel local track. During a window, the player evaluates its track at scene time minus start; otherwise it evaluates the outer base/direct track at scene time. Windows cannot nest. Older runtimes reject the capability rather than silently dropping actions. Existing bundles without windows retain their evaluation behavior.

Runtime 1.2 supports optional action-window `timing` with `sourceStart`, `sourceEnd` and positive `rate`, guarded by `composition.action-timing-v1`. The finite outer window determines how many trimmed cycles play. Source time wraps within the trimmed range; at the exclusive window end the outer scene track resumes. Interval comparisons use 12-decimal animation precision, shared with the editor.
