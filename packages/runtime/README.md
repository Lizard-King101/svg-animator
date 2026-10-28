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

## Bone and IK animation (runtime 1.3)

The additive `rig.pose-v1` capability enables optional `RuntimeBundleV1.rigs`. Numeric channels target an armature ID and use `bones.<boneId>.pose`, `poseX`, or `poseY`. Each frame evaluates authored offsets, solves enabled IK constraints, then deforms rest-space path points and rigid attachments before rendering. Editor and runtime share the same FK, IK, attachment and weight kernel. Seeks never accumulate deformation or overwrite authored angles with solved angles.

Rig channels support the same temporal curves and reusable action windows as artwork channels, including trims, rate and repeats; no key baking is required. Shared point owners, inherited and independent Bézier handles, unweighted rest points and reflected parent transforms retain their existing behavior. Players copy the rig data, so independent players cannot affect each other's poses.

Compilation reports conflicting direct geometry/transform tracks on bound artwork or its ancestors, and channels on bones controlled by enabled IK. Animate the IK target or disable its constraint to animate the chain with FK. Paint, visibility and opacity remain independently animatable. Missing bones, artwork, points, topology or capability declarations are rejected before playback. Static posed exports continue using materialized artwork and do not require rig metadata.

## Outline sections (runtime 1.4)

`render.outline-sections-v1` enables optional `path.outlineSections`. A section has a stable `id`, `contourId`, `{segmentId, t}` start/end addresses and optional `startTaper` / `endTaper` values (`length` and `tipWidth`, normalized to 0–1). `fullContour` distinguishes a full closed loop from a zero-length section. Implicit closing segments use `<contourId>:close`. Missing sections preserve legacy full strokes; an empty list hides only the stroke.

The shared pure projection runs after deformation. Generated filled stroke geometry follows curves, rounded corners, section trims, smooth end tapers, dashes, Draw Progress, caps and joins. It never creates document points or changes weights. Clipping and alignment use the source fill; gradient coordinates stay anchored to the source contour bounds. Editor, static export, onion skins and portable playback use the same projection. There are no trim/taper animation channels in this pass.

Explicitly open coincident endpoints carry `path.explicitClosure: true` and require the same capability. Older portable bundles preserve their inferred-closure behavior. Malformed endpoint references, overlapping sections, crossing taper lengths and missing capability declarations fail validation before DOM mutation.

Outline dash expansion is limited to 20,000 runs per path, measured over complete sections regardless of Draw Progress. Increase dash lengths for denser artwork. Exceeding the limit through animated deformation pauses playback and emits an error before changing the displayed frame; an explicit `seek()` throws the same error. Width-profile samples are shared across each section, so ordinary constant-width dash fragments retain compact geometry.

## Visible clipping sources (runtime 1.5)

`render.visible-clipping-v1` guards the optional `clipping.sourceVisibility: true` descriptor. The source target's visibility controls its fill behind clipped contents and its stroke above them. The clipping geometry always remains active, shares geometry and transform animation with those paint projections, and ignores source opacity, Draw Progress and paint. Descendant visibility remains meaningful for a group source. Ancestor clips still enclose the complete result. Runtime markup links uniquely identified projections with `data-render-target` and `data-render-projection`; this does not duplicate document targets or weights. Legacy bundles and their unprojected markup keep their previous behavior.

## Live spring constraints (1.6)

Bundles with rig-v6 spring settings require `rig.spring-v1` as well as `rig.pose-v1`. Enabled spring rigs are exported even when they have no animation tracks. The player evaluates authored channels, orders spring and IK writers by ancestry and target dependencies, then deforms the existing SVG artwork. A physics-driven child point may drive a separate IK chain; physics and IK cannot write the same bone. Optional inclusive `endBoneId` limits a constraint to an ancestry path; optional `boneSettings` overrides stiffness, damping, gravity, limit and mix per bone. Older records without these fields retain whole-strand behavior and shared defaults. Physics settings are portable; transient velocity and replay checkpoints are not serialized.

Physics uses fixed 120 Hz simulation with interpolated output at the requested time. Direct seeks reconstruct first-traversal state, while forward looping carries motion across cycles using an unwrapped clock. Pausing freezes physics; changing Loop or seeking resets replay state. Reverse playback uses deterministic timeline reconstruction. Existing bundles without springs keep the previous stateless rig path. A runtime lacking `rig.spring-v1` rejects the bundle explicitly.

## Wind (1.7)

Optional armature `windX`/`windY` base values default to zero. Numeric `physics.windX` and `physics.windY` channels animate them, including composed action windows. Spring `windInfluence` defaults to 1, ranges from 0 to 10, and can be overridden per bone. Wind uses canvas axes (+X right, +Y down), with acceleration scaled by bone length; it is independent of the armature’s rotation. Saved wind values, influence settings or wind channels require `rig.wind-v1`. Older documents without these fields retain their previous behavior. Sampling and loop clocks are shared with spring physics; no random gust generator is involved.
