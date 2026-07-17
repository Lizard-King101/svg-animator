# Shipped Features

SVG Animator is a motion SVG studio: a browser-based drawing, editing, and keyframe-animation workspace. This file records shipped behavior; planned work lives in [ROADMAP.md](ROADMAP.md).

## Documents and persistence

- Multi-document tabs with per-document undo/redo history. Unchanged identity, artwork, animation, and guide sections are shared across entries; history retains up to 50 entries and 64 MiB of unique section data.
- Asynchronous local project gallery, explicit loading/error states, dimension presets, and versioned document envelopes.
- IndexedDB persistence separates project metadata, documents, and thumbnails. A one-time localStorage migration retains a read-only legacy backup; localStorage and then in-memory repositories are used if IndexedDB is unavailable.
- Coalesced autosaves write only the newest pending revision. Artwork thumbnails are generated during idle time and animation-only edits reuse the existing thumbnail.
- Safe SVG file import from the project gallery with editable/preserved/removed-content reporting.
- Native editable linear/radial gradient import with inherited definitions, transforms, spread modes, translucent stops, direct canvas handles, and grouped timeline animation.
- `DOMParser` ingestion for groups, paths, rectangles, circles/ellipses, lines, polylines, polygons, and basic text.
- Full path-command normalization for absolute/relative line, cubic, shorthand, quadratic, elliptical-arc, and close commands.
- Unsupported safe SVG nodes survive as sanitized source through save, reload, editor rendering, and static export.
- Project-card actions for deterministic editable Project JSON export and deletion, plus a sectioned editor publishing dialog for Static SVG, Embedded Animation SVG, self-contained Animated SVG, Runtime Assets ZIP, and Web Bundle ZIP exports with deterministic runtime JSON, markup, manifests, filenames, and build diagnostics.
- Canvas pan/zoom, rulers, draggable numeric guides, guide expressions, and guide locking.

## Artwork editing

- Pen-authored open and closed paths with straight and cubic segments.
- Rectangle, ellipse, and multiline text elements.
- Alpha-aware fill/stroke color picking, center/inside/outside alignment, authored dashes and offset, caps, joins, miter limits, rectangle corner radius, element opacity, visibility, and locking.
- Direct linear/radial gradient handles plus compact stop popovers in Properties and Animate modes.
- Element translate, scale, rotation, and editable transform origin.
- Direct path editing: anchors, mirrored/broken bezier handles, segment selection, point insertion/deletion, straight/curve conversion, and rounded anchors.
- Compound paths with multiple contours and even-odd/nonzero fill rules.
- Precise and optimized stroke-to-path conversion, including alignment, authored dash pieces, caps, joins, miter limits, closed strokes, and curve-native boolean cleanup.

## Layers and composition

- Recursive layer tree with selection, range/multiple selection, rename, drag ordering/reparenting, duplicate, visibility, lock, and delete.
- Groups, ungrouping, nested rendering, and clipping masks.
- Combine selected paths while preserving world-space geometry.
- Motion-path attachment and detachment.

## Animation

- Versioned animation document with duration, loop, tracks, markers, and runtime-variable storage.
- Edit/animate modes, playback, scrubbing, timeline zoom/fit, nested rows, per-property tracks, and non-interactive summary diamonds on collapsed layers.
- Virtualized fixed-height rows and visible-time key filtering keep timeline DOM proportional to the viewport rather than the document's total key count.
- Keyframe add/remove, multi-selection, marquee, drag/nudge, copy/paste/delete, individual graph-key retiming, and easing presets.
- AE-style numeric speed graphs with signed property-units-per-second, independent influence lengths, linked speed continuity, exact fields, vertical fit/pan/zoom, and paired X/Y overlays for compatible properties.
- Numeric, boolean, string, and color evaluation; deterministic interpolation, temporal cubic overshoot, bounded-property clamping, and retained preview base-state restoration.
- Animatable transforms, visibility, opacity, fill/stroke, stroke width, draw progress, motion progress/orientation/offsets, and path-point positions.
- Compiled evaluation plans sort and validate tracks once, use active-segment cursors for forward playback, and binary search for seeks/reverse movement.
- Playback and scrubbing use a retained direct-SVG renderer outside Angular, while edit-mode artwork remains Angular-rendered.
- A pure deterministic `compileRuntimeAnimation(document)` boundary produces `RuntimeBundleV1` scene data and compact numeric/color/discrete tracks, with diagnostics returned separately.
- A dependency-free standalone player provides typed ESM and `SVGAnimatorRuntime` browser builds, scoped multiple instances, controls/events/markers, reverse/rate/loop playback, reduced-motion autoplay handling, signature/capability validation, and destroy/restore cleanup.

## Current limits

- Runtime variables are serialized metadata but do not yet drive expressions or state transitions.
- Complex imported transforms with skew, patterns, effects, rich text, and other non-native features are preserved but are not directly editable.
- Multi-layer canvas marquee and multi-object transforms are not yet available.
- Boolean editing is currently used by stroke conversion rather than exposed as a complete user-facing boolean toolset.
- Patterns, images, masks, filters, reusable symbol semantics, rich text, embedded fonts, and accessibility metadata remain planned.
- Expressions, physics, constraints, bones, and IK remain planned.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership rules and [SVG_COMPATIBILITY.md](SVG_COMPATIBILITY.md) for element-level coverage.
