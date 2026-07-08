# Animation MVP Roadmap

Planning reference for the animation side of SVG Animator. This document tracks the intended model, runtime strategy, UI direction, compatibility rules, and phased implementation status.

Status legend:

| Status | Meaning |
|---|---|
| Done | Implemented and merged |
| Planned | Intended for the MVP or a named later phase |
| Deferred | Valuable, but intentionally outside the first animation release |
| Open | Needs a product or technical decision |

---

## Guiding Model

SVG Animator should treat a document as two connected layers:

1. **Artwork model**
   Paths, shapes, text, groups, clipping, base geometry, styles, and base transform channels.

2. **Animation model**
   Timeline data that targets stable element IDs and property paths over time.

Animation should evaluate on top of the base artwork. It should not destroy or rewrite the drawing source. For example, a rectangle can keep its geometry at `x=120`, `y=80`, while animation tracks drive `transform.translateX`, `transform.rotation`, or `opacity`.

This preserves editability and makes animation data portable to external webpages.

---

## Current Foundation

| Area | Status | Notes |
|---|---|---|
| Persistent element IDs | Done | Existing element IDs are used as animation targets |
| Transform channels | Done | Paths, shapes, text, and groups have translate, scale, rotation, and origin |
| Transform rendering | Done | Editor and export use generated SVG matrix transforms |
| Group wrapper transforms | Done | Groups transform as wrappers rather than rewriting children |
| Shape frame editing | Done | Rectangles and ellipses expose geometry `X/Y/W/H` for alignment |
| Clip/group movement UX | Done | Selected groups and clip shapes can be moved via selection bounds |
| Stable transform origins | Done | Origins are pinned when needed to avoid group bounds drift |
| Legacy save compatibility | Done | Missing transform data defaults safely |

---

## MVP Scope

The MVP should prove the full animation loop with the smallest stable property set:

| Feature | Status | Notes |
|---|---|---|
| Animation schema | Planned | Versioned JSON stored with project saves |
| Timeline state | Planned | Duration, current time, playback state, loop settings |
| Keyframe model | Planned | Timestamped values with easing metadata |
| Track targeting | Planned | Tracks target `elementId + propertyPath` |
| Interpolation engine | Planned | Number, color, boolean/discrete, and transform interpolation |
| Editor playback | Planned | Scrub and preview inside the editor |
| Timeline panel | Planned | Playhead, track rows, keyframes, selected element filtering |
| Auto-key mode | Planned | Property edits at the playhead create/update keyframes |
| Manual key controls | Planned | Add/remove keyframe for selected property |
| Transform animation | Planned | Translate X/Y, scale X/Y, rotation, origin X/Y |
| Opacity animation | Planned | Element/group opacity should be added as an animatable property |
| SVG export with animation data | Planned | Embed JSON payload or export JSON beside SVG |
| Lightweight runtime | Planned | External script evaluates animation data against SVG DOM |

MVP exit criteria:

- A user can create a drawing, switch to Animate mode, keyframe a transform, preview it, save/load it, export it, and run the animation on an external webpage with the runtime.
- Unknown future animation data does not break older projects or the editor.
- Runtime failure is graceful when a target element/property no longer exists.

---

## Animation Data Shape

Initial schema should be explicit and versioned:

```ts
interface AnimationDocumentV1 {
  version: 1;
  duration: number;
  fpsHint?: number;
  loop?: boolean;
  tracks: AnimationTrack[];
  markers: TimelineMarker[];
  variables?: RuntimeVariable[];
}

interface AnimationTrack {
  id: string;
  targetId: string;
  property: string;
  valueType: "number" | "color" | "boolean" | "string";
  keyframes: Keyframe[];
  enabled?: boolean;
}

interface Keyframe {
  id: string;
  time: number;
  value: unknown;
  easing?: EasingSpec;
}
```

Example property paths:

```ts
transform.translateX
transform.translateY
transform.scaleX
transform.scaleY
transform.rotation
transform.originX
transform.originY
settings.fill
settings.stroke
settings.stroke_width
opacity
visible
```

Compatibility rules:

- Always include an animation schema version.
- Ignore unknown fields.
- Skip unknown track types or property paths without crashing.
- Keep target element IDs stable across save/load.
- Avoid destructive migrations. Prefer additive migrations.
- Preserve orphaned tracks when possible so users can recover if an element returns.

---

## Runtime Strategy

External webpage support should use a lightweight JavaScript runtime rather than relying only on SMIL or CSS generation.

The runtime should:

- discover animation JSON embedded in an SVG or accept JSON passed by the host page
- resolve target element IDs
- evaluate tracks at the current time
- apply SVG attributes, style values, and transform matrices
- expose playback controls
- emit lifecycle and marker events
- fail gracefully when targets are missing

Suggested public API:

```ts
const player = createSvgAnimator(svgElement, animationData);

player.play();
player.pause();
player.seek(1.25);
player.setSpeed(0.5);
player.playSegment("hoverIn");
player.trigger("open");
player.setVariable("isHovered", true);
player.destroy();
```

Export formats to support over time:

| Format | Status | Notes |
|---|---|---|
| SVG with embedded animation JSON | Planned | Best single-file authoring export |
| SVG plus external JSON | Planned | Better for production caching/versioning |
| Runtime JS bundle | Planned | Small player script loaded by host page |
| Pure CSS/SMIL export | Deferred | Useful, but less flexible for interactivity |
| PNG/video sequence export | Deferred | Different rendering/export pipeline |

---

## Animatable Properties

### MVP Properties

| Property group | Status | Notes |
|---|---|---|
| Transform translate | Planned | Core motion property |
| Transform scale | Planned | Uses existing transform channels |
| Transform rotation | Planned | Uses pinned origin |
| Transform origin | Planned | Advanced but already part of transform model |
| Opacity | Planned | Needs element/group opacity support in model/render/export |
| Fill color | Planned | Useful for common SVG animation |
| Stroke color | Planned | Useful for common SVG animation |
| Stroke width | Planned | Number interpolation |
| Visibility | Planned | Discrete/stepped interpolation |

### Later Properties

| Property group | Status | Notes |
|---|---|---|
| Text content | Deferred | Discrete keyframes only |
| Stroke dash offset/array | Deferred | Needs dashed stroke attributes first |
| Filters/effects | Deferred | Depends on future effect model |
| Path points and handles | Deferred | Powerful, but topology-sensitive |
| Path morphing | Deferred | Requires matching point/segment topology |

---

## Path, Point, And Rig Animation

Direct line/point animation should not be part of the first MVP, but the model should not block it.

Recommended progression:

1. **Direct point tracks**
   Animate stable point IDs and control handle coordinates.

2. **Topology safeguards**
   Warn before deleting points with animation tracks. Preserve orphaned tracks where possible.

3. **Named proxy controls**
   User-facing controls such as `mouthCorner`, `tailTip`, or `waveAmount` drive multiple point offsets.

4. **Bones/deformers**
   Weighted bindings from proxy bones to path points.

5. **Constraints**
   Higher-level behavior like follow, aim, squash, or pinned anchors.

Rationale:

- Direct point animation is expressive but hard to manage.
- Proxy controls make complex path animation usable.
- Bones/deformers should be built on top of stable point identity and track targeting, not mixed into the MVP.

---

## Runtime Functions And Modifiers

Built-in modifiers are useful, but arbitrary inline JavaScript should not be part of the default export path.

Planned built-in functions:

| Function | Status | Notes |
|---|---|---|
| sine | Deferred | Oscillation, hover motion, floating effects |
| triangle | Deferred | Mechanical looping motion |
| noise | Deferred | Seeded procedural variation |
| random | Deferred | Seeded and deterministic where possible |
| spring | Deferred | Secondary motion |
| bounce | Deferred | Preset easing/modifier |
| decay | Deferred | Damped motion |
| loop | Planned | Repeat timeline or segment |
| ping-pong | Planned | Alternate repeated playback |
| clamp/map | Deferred | Utility modifiers |
| follow path | Deferred | Needs path sampling utilities |

Runtime extension rule:

```ts
player.registerFunction("customWave", fn);
```

Custom functions should be registered by the host page, not embedded as arbitrary code in exported SVG by default.

---

## Trigger Hooks And Interactivity

Interactive SVGs should communicate with parent pages through DOM events and a small runtime API.

Planned emitted events:

| Event | Status | Notes |
|---|---|---|
| animation start | Planned | Runtime lifecycle |
| animation end | Planned | Runtime lifecycle |
| loop | Planned | Fired when loop restarts |
| marker reached | Planned | Timeline marker callbacks |
| segment start/end | Deferred | Useful once named segments exist |
| element click | Planned | Optional runtime event bridge |
| hover enter/exit | Planned | Optional runtime event bridge |
| custom trigger | Planned | Parent page can trigger named animation behavior |

DOM event naming:

```ts
svg.dispatchEvent(new CustomEvent("svganimator:marker", {
  detail: { name: "introDone", time: 1.2 }
}));
```

Parent page input examples:

```ts
player.trigger("open");
player.playSegment("hoverIn");
player.setVariable("expanded", true);
```

---

## UI/UX Direction

The editor should have distinct **Edit** and **Animate** modes.

### Edit Mode

Purpose: create stable artwork.

Expected tools:

- drawing tools
- path point editing
- shape frame editing
- group/clip/layer operations
- base style editing
- base transform setup

### Animate Mode

Purpose: keyframe and preview property changes over time.

Expected tools:

- timeline panel
- playhead and playback controls
- selected element track list
- keyframe creation/removal
- auto-key toggle
- easing controls
- marker controls
- loop/segment controls

Rules:

- In Animate mode, property edits at the playhead should create or update keyframes when auto-key is enabled.
- If auto-key is disabled, edits should either change the base value clearly or require an explicit base-edit action.
- Timeline scrubbing should be non-destructive.
- The user should always be able to return to the base pose.

Open UX decisions:

| Decision | Status | Notes |
|---|---|---|
| Auto-key default | Open | Safer default may be off |
| Timeline placement | Open | Bottom panel is conventional |
| Track filtering | Open | Selected element only vs full layer tree |
| Keyframe density | Open | Compact track rows vs full property rows |
| Edit while previewing | Open | Needs clear rules to avoid accidental keyframes |

---

## Implementation Phases

### Phase 0: Transform Foundation

Status: Done

- Persistent transforms
- Group wrapper transforms
- Transform handles
- Transform export
- Shape frame controls
- Stable origins

### Phase 1: Animation Model

Status: Planned

- Add `animation` to `SVGSave`
- Define versioned schema
- Add track/keyframe classes or plain model helpers
- Add interpolation utilities
- Add migration/restore defaults
- Add tests for save/load and legacy compatibility

### Phase 2: Editor Playback

Status: Planned

- Timeline state in editor service or a dedicated animation service
- Play, pause, seek, loop
- Evaluate animation state into rendered SVG preview
- Keep base document state separate from evaluated preview state

### Phase 3: Timeline UI

Status: Planned

- Animate mode toggle
- Bottom timeline panel
- Playhead
- Duration controls
- Keyframe buttons
- Auto-key toggle
- Track rows for selected element properties
- Basic easing selection

### Phase 4: Transform And Opacity Tracks

Status: Planned

- Translate, scale, rotation, origin
- Add opacity to element model/render/export
- Number interpolation
- Discrete visibility interpolation

### Phase 5: Runtime And Export

Status: Planned

- Runtime evaluator package/file
- Embedded animation JSON export
- External JSON export path
- Public player API
- Marker/lifecycle events
- Basic webpage integration example

### Phase 6: Style Tracks

Status: Planned

- Fill color
- Stroke color
- Stroke width
- Easing and interpolation polish

### Phase 7: Interaction Hooks

Status: Planned

- Click/hover triggers
- Named markers and segments
- Parent page event bridge
- Runtime variables

### Phase 8: Advanced Motion

Status: Deferred

- Path point animation
- Path morphing
- Proxy controls
- Bones/deformers
- Procedural modifiers
- Physics-like runtime functions

---

## Near-Term Checklist

| Task | Status |
|---|---|
| Create animation MVP planning doc | Done |
| Update README to link animation MVP plan | Done |
| Add animation schema types | Planned |
| Add animation defaults to new SVGs | Planned |
| Preserve animation data in project save/load | Planned |
| Add interpolation utilities | Planned |
| Add editor playback service | Planned |
| Add Animate mode shell | Planned |
| Add timeline panel shell | Planned |
| Add transform keyframe UI | Planned |
| Add runtime export spike | Planned |

