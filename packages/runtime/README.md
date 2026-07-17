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
