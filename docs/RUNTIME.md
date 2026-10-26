# SVG Animator Runtime v1

The standalone runtime is a private-named, dependency-free package at version 1.0.0. Its public TypeScript names, `RuntimeBundleV1`, and browser global `SVGAnimatorRuntime` are stable. The editor app and runtime use independent SemVer; persisted documents use envelope v7 with animation schema v2. Project color palettes are editor metadata and do not change the runtime format.

## Install and mount

The package is currently distributed through exported Web Bundles rather than a public registry. In typed ESM code:

```ts
import { createEmbeddedPlayer, createPlayer, loadPlayer } from "./runtime/svg-animator-runtime.esm.js";
import bundle from "./animation.json" with { type: "json" };

const player = createPlayer(document.querySelector("svg"), bundle);
player.play();

const external = await loadPlayer("#artwork", "/animation.json");

// For an exported Embedded Animation SVG already present inline:
const embedded = createEmbeddedPlayer("#embedded-artwork");
```

The browser build exposes `SVGAnimatorRuntime.createPlayer`, `createEmbeddedPlayer`, `loadPlayer`, `RuntimePlayerError`, and `bootstrapAnimatedSVG`. Mounting is scoped to the supplied SVG root, so multiple players may coexist. The matching runtime-bound SVG must carry the bundle artwork signature.

## Controls, events, and cleanup

Players mount paused. Use `play()`, `pause()`, `stop()`, `seek(seconds)`, `setPlaybackRate(rate)`, and `setLoop(boolean)`. Read `time`, `duration`, `state`, `playbackRate`, and `loop`. Rates may be negative for reverse playback.

`on()` supports `ready`, `play`, `pause`, `stop`, `seek`, `complete`, `loop`, `marker`, `error`, and `destroy`. Marker events include forward/reverse direction. Call `destroy()` when unmounting; it cancels playback, removes listeners, and restores every initial SVG attribute.

Generated Animated SVG requests autoplay and uses the project loop setting. Autoplay is suppressed when `prefers-reduced-motion: reduce` matches. An explicit API `play()` is still honored; `autoplayWhenReducedMotion` is available only for experiences with a deliberate user-facing override.

## Export and embedding

- **Export project** in a home project card's three-dot menu downloads the editable v5 Project JSON envelope for bug reproduction and parity fixtures. It remains available when animation diagnostics block runtime exports; gallery re-import is not yet exposed.
- Static SVG remains script-free and contains no runtime hooks.
- Embedded Animation SVG contains matching artwork and inert bundle JSON, but no player code or autoplay script. Load one shared ESM or browser runtime and call `createEmbeddedPlayer(svgRoot)`; this keeps each asset self-contained without duplicating the runtime.
- Animated SVG embeds matching bundle JSON and browser runtime, and works in direct navigation, inline SVG, `<object>`, and `<iframe>` contexts where scripts are allowed.
- Browsers do not execute SVG scripts loaded through `<img>` or CSS backgrounds.
- Runtime Assets ZIP contains `artwork.svg` and `animation.json`.
- Web Bundle ZIP adds ESM/browser players, controls and marker logging, and an integration README.

Serve SVG as `image/svg+xml`, JSON as `application/json`, JavaScript as `text/javascript`, and ZIP as `application/zip`. Serve examples over HTTP rather than `file://`.

For an Embedded Animation SVG loaded through `<object>`, wait for the object to load and pass its SVG document root to the shared browser runtime:

```html
<object id="artwork" data="drawing-animation.svg" type="image/svg+xml"></object>
<script src="svg-animator-runtime.min.js"></script>
<script>
artwork.addEventListener("load", () => {
  const player = SVGAnimatorRuntime.createEmbeddedPlayer(artwork.contentDocument.documentElement);
  player.play();
});
</script>
```

SVGs using Plus Jakarta Sans include a document-scoped Google Fonts import so standalone navigation, inline markup, `<object>`, and `<iframe>` rendering use the same family and weights as the editor. This font still requires network access and CSP permission for `fonts.googleapis.com` and `fonts.gstatic.com`; system font selections depend on fonts installed on the viewer's device. The embedded runtime remains archival, but an externally hosted font does not.

## CSP and security

Animated SVG is active script content. Host it only from trusted origins, sanitize any surrounding user content, and configure `script-src`, `object-src`, `frame-src`, and fetch directives deliberately. A strict CSP may block the embedded script; use an Embedded Animation SVG or Runtime Assets plus an externally allowed player in that case. The runtime uses no `eval` or dynamic code generation. Embedded bundle data is inert JSON and imported SVG source remains sanitized.

## Bundle and compatibility

`RuntimeBundleV1` includes its kind, integer format version, generator version, required capabilities, artwork dimensions/viewBox/signature, plain scene targets, markers, loop settings, and compact tracks. A target transform records both its resolved origin and `autoOrigin`; automatic origins follow native geometry bounds when position, size, or path points animate. Editor work-area metadata is excluded. Runtime variables are metadata only in v1.

Runtime 1.3 adds `rig.pose-v1` and optional `rigs` for bone and IK target channels. Numeric tracks address an armature ID with `bones.<boneId>.pose`, `poseX`, or `poseY`. The player evaluates authored offsets, solves enabled IK, and materializes weighted paths and rigid attachments before rendering. This uses the editor's shared rig kernel, preserves shared and independent handle weights, and supports trimmed/rate/repeated reusable actions without baking keys. Bone setup's suspended solve resumes during animated evaluation without changing the saved setup flag. Direct geometry/transform channels on controlled artwork or ancestors, and channels on IK-controlled chain bones, produce actionable compiler diagnostics. Paint and opacity channels remain independent. Static exports continue to use materialized posed artwork.

Runtime 1.4 adds `render.outline-sections-v1`. Optional `path.outlineSections` stores stable section IDs, contour IDs, curve-local `{ segmentId, t }` endpoints, and independent normalized start/end tapers. A full closed loop uses `fullContour: true`; implicit closing edges use `<contourId>:close`. Missing metadata keeps the legacy full stroke, while `[]` keeps the fill and hides the outline. The same pure projection follows current path geometry after bone/IK evaluation in canvas, onion skins, static export and runtime playback. Dashes and Draw Progress reveal the visible authored sections; taper widths are evaluated against each complete section, so dash/reveal fragments do not restart their tapers. Inside/outside clipping uses the original closed fill. Object-bounding-box stroke gradients are mapped through that source contour's bounds rather than each trimmed fragment. Projection uses sampled filled stroke geometry and preserves authored caps, joins and miter limits.

The outline capability also protects explicit open contours whose endpoints coincide or can meet during geometry/rig animation. Those targets carry `path.explicitClosure: true`; older runtime bundles continue using legacy inferred closure. The player validates missing section references, overlap, taper ranges and capability declarations before mutation. Authored patterns exceeding 20,000 dash runs per outlined path are refused with a request to increase dash lengths. This limit uses the complete authored outline, even at zero Draw Progress. If deformation crosses the limit during playback, the player pauses and emits an error while retaining the prior visible frame; explicit `seek()` also throws that error. Trim/taper animation channels are not part of this capability; sections follow existing geometry and rig animation automatically.

Runtime 1.5 adds `render.visible-clipping-v1` and `clipping.sourceVisibility: true`. A clipping source's `visible` channel controls its painted fill and stroke while its geometry keeps clipping the group's contents. The fill paints behind those contents, and the stroke (including outline sections) paints above them without being cut by its own clipping boundary. Ancestor clips still apply. The exported SVG contains separate render projections linked by `data-render-target`; all receive the same geometry and transform animation, including rig deformation. The geometry projection ignores the source root's visibility, opacity, paint and Draw Progress. A group source still honors its descendants' visibility. These projections do not introduce artwork or rig targets. Bundles without this optional capability retain their original single-node behavior.

Players validate kind, format, capabilities, structure, and artwork signature before mutation. Failures use typed `RuntimePlayerError` codes. Optional metadata may be added within format v1. Any new required structure or changed semantics requires a new integer format and an adapter. A runtime major supports its own format generation and the immediately previous generation. Self-contained Animated SVG embeds its matching player for archival playback.

See [RUNTIME_TESTING.md](RUNTIME_TESTING.md) for capturing real projects and adding editor/runtime parity fixtures, [COMPATIBILITY.md](COMPATIBILITY.md), [MIGRATION.md](MIGRATION.md), the [JSON Schema](../schemas/runtime-bundle-v1.schema.json), and the generated [API report](../packages/runtime/API_REPORT.md).
