# Animation System Status

This document records the shipped animation architecture and compatibility contract. For day-to-day controls and an example project, start with [ANIMATION_GUIDE.md](ANIMATION_GUIDE.md).

## Current boundary

The authoring system is implemented end to end inside the editor:

- property keyframes and preset easing
- numeric temporal speed/influence handles
- Timeline and Graph editing surfaces
- compiled track evaluation
- retained imperative SVG playback and scrubbing
- project migration, history, autosave, and reload
- a deterministic compiler contract for future runtime export

Static SVG export remains available. Animated JSON publishing, an embedded/external export UI, and the standalone player are not shipped.

## Model

An editor document has two connected layers:

1. The artwork model owns shapes, paths, text, groups, clipping, gradients, base geometry/styles, and base transform channels.
2. The animation model targets stable element IDs and property paths without destructively rewriting the artwork.

The persisted document envelope is version 4. Its animation document is version 2:

```ts
interface AnimationDocument {
  version: 2;
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
  temporal?: TemporalTangents;
}

interface TemporalHandle {
  speed: number;      // property units per second
  influence: number;  // 0–1 of the adjacent segment duration
}

interface TemporalTangents {
  in?: TemporalHandle;
  out?: TemporalHandle;
  linked: boolean;
}
```

Tracks are normalized into time order with one keyframe per timestamp. Retiming collisions replace the destination key deterministically.

When `temporal` is absent, the evaluator uses the saved easing preset exactly. Editing a preset in the graph initializes equivalent temporal handles; reapplying a preset clears custom temporal data for the affected segment. Linked handles share speed continuity only, while incoming and outgoing influences remain independent.

Numeric temporal segments are time/value cubics constructed from the source's outgoing handle and destination's incoming handle. Signed speed and overshoot are valid. Property adapters clamp bounded outputs such as opacity, progress, and gradient offsets at the application boundary.

## Animatable properties

The authoring evaluator and runtime compiler support:

- Transform: translate X/Y, scale X/Y, rotation, and origin X/Y
- Style: opacity, fill/stroke color, and stroke width
- Visibility: stepped boolean visibility
- Path: draw progress and stable path-point X/Y positions
- Motion path: progress, rotate-to-path, offset angle, and offset X/Y
- Gradients: linear/radial geometry, stop offset, stop color, and stop opacity
- Grouped path-shape and gradient editing surfaces composed from their underlying tracks

Numeric graph pairing is semantic rather than name-only. Translate, scale, origin, motion offset, each path point, and compatible gradient coordinates automatically overlay their X/Y partner. Other numeric properties use a single-channel speed graph.

## Editing behavior

The animation timeline component uses `OnPush` change detection and keeps the layer/property list aligned with either surface:

- Timeline mode displays property lanes, real keys on expanded properties, and non-interactive aggregate diamonds on collapsed layers.
- Graph mode displays numeric speed curves, separate X/Y colors and node shapes, roots that retime an individual channel, and incoming/outgoing temporal handles.
- Wheel over the lane side zooms time around the pointer.
- Middle-mouse drag pans time and either scrolls timeline rows or pans the graph's vertical speed range.
- Ctrl/Command + wheel over the graph zooms speed around the pointer.
- Horizontal and vertical Fit commands restore useful visible ranges.

Pointer gestures retain global tracking after they leave a handle. High-frequency scrubbing, graph editing, numeric scrubbing, panning, and key retiming are coalesced through `requestAnimationFrame`. A live gesture commits one mutation on pointer-up, Escape restores the captured state, and a no-op produces no history/autosave entry.

Timeline numeric fields preserve both direct entry and scrubbing: click without movement focuses/selects the input; horizontal drag changes its value. History restoration invalidates timeline projections and refreshes the displayed values.

Rows are fixed-height and virtualized with overscan. Each sorted track is binary-searched for the visible time range, so the surface creates DOM only for visible rows and keys rather than all stored keyframes. Layer summary projections and graph paths are revision-keyed caches.

## Evaluation plan

`AnimationEvaluationPlan` is compiled when document structure changes or affected tracks are invalidated. Compilation:

- flattens stable target IDs once
- indexes tracks by target/property
- normalizes and validates keyframes once
- compiles times and numeric values into typed arrays
- compiles colors, discrete values, segment modes, and temporal coefficients
- retains target/property metadata for the render-domain adapter

Forward playback advances a per-track active-segment cursor. Seeking and reverse movement use binary search. Frame evaluation does not sort keyframes, recursively search the element tree, or create a new array for every track.

Property/render adapters combine related channels before output. Transform components generate one final transform write, path-point channels generate one path-data write, and gradient/paint channels share their applicable output boundary.

## Preview and rendering

Angular owns edit-mode artwork. Playback and scrubbing use `ImperativeSvgRenderer`, which retains SVG element/gradient/stop references by stable ID and batches direct DOM changes outside Angular's zone.

The renderer handles transforms, opacity, visibility, paint, gradient geometry/stops, stroke width, path data, draw progress, and motion-path transforms. The playhead and time display receive lightweight imperative frame updates. Angular is re-entered for play/pause/end state changes and paused editing refreshes.

Preview base values are captured for the entire preview session and restored when preview ends. The model may expose evaluated values for paused authoring and overlays, but preview-mutated state is excluded from serialization. Selection/path overlays are hidden during active playback and restored when playback pauses.

## History and persistence

`DocumentMutationService` is the persistent change boundary. Mutation domains distinguish artwork, animation, guides, metadata, and thumbnail-affecting artwork. One committed change captures one plain base-state save, then reuses it for history and persistence.

History shares unchanged identity, artwork, animation, and guide sections. A document retains at most 50 entries and 64 MiB of unique serialized section data. Undo/redo restores stable element/point/line selections, resets the mutation baseline, persists the restored document, and refreshes animation/UI projections.

`ProjectRepository` is asynchronous. IndexedDB is primary and separates:

- `projects`: lightweight metadata and revision
- `documents`: versioned document envelopes
- `thumbnails`: SVG thumbnail strings and revision
- `meta`: database/migration state

Document and metadata updates use one transaction. Autosaves are coalesced to the newest pending revision. Thumbnails are generated during idle time only after artwork changes.

Existing localStorage projects migrate once, are validated by the sequential document migrators, and leave a read-only legacy backup. If IndexedDB fails, the service tries the legacy localStorage format. If that fails, it retains an in-memory session and exposes a persistent warning that changes are not being saved.

## Runtime compiler contract

`compileRuntimeAnimation(document)` is pure and deterministic. It emits:

```ts
interface CompiledAnimationV1 {
  kind: "svg-animator/compiled-animation";
  version: 1;
  targets: string[];
  properties: string[];
  duration: number;
  loop: boolean;
  markers: TimelineMarker[];
  variables: RuntimeVariable[];
  tracks: CompiledRuntimeTrackV1[];
  diagnostics: RuntimeCompileDiagnostic[];
}
```

The payload interns target/property strings, stores numeric time/value arrays with segment modes and temporal coefficients, packs colors with interpolation-space metadata, and preserves discrete boolean/string tracks. Diagnostics report orphaned targets, unsupported properties, invalid values, and skipped tracks.

Compiled caches are never persisted in editable project documents. Golden tests compare compiled evaluation with authoring evaluation at endpoints and sampled intermediate times. A later export cut will combine the static base SVG with this payload for embedded JSON, external JSON, and the lightweight player.

## Compatibility rules

- Keep element, path-point, gradient-stop, track, and keyframe IDs stable.
- Ignore unknown fields and skip unsupported runtime tracks without crashing.
- Preserve orphaned authoring tracks when possible so a restored target can recover them.
- Add sequential migration fixtures before changing document or animation versions.
- Never add temporal data while migrating v1 animation presets to v2.
- Never serialize preview-applied values or compiled runtime caches.
- Keep static SVG export free of editor handles, hit targets, and runtime data.

## Verification

Run the deterministic suite and production build:

```bash
npm test -- --watch=false
npm run build
```

Tests cover migration, temporal math, property clamping, track invalidation, cursor/binary-search selection, base-state restoration, timeline/graph gestures, imperative DOM output, history sharing, repository fallbacks, and compiler equivalence. Performance measurements use the repeatable Chrome workflow in [ANIMATION_PERFORMANCE.md](ANIMATION_PERFORMANCE.md), not wall-clock CI assertions.
