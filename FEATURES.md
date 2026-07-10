# Shipped Features

SVG Animator is a motion SVG studio: a browser-based drawing, editing, and keyframe-animation workspace. This file records shipped behavior; planned work lives in [ROADMAP.md](ROADMAP.md).

## Documents and persistence

- Multi-document tabs with per-document undo/redo history (50 snapshots).
- Local project gallery, thumbnails, autosave, dimension presets, and versioned, backward-compatible `localStorage` saves.
- Safe SVG file import from the project gallery with editable/preserved/removed-content reporting.
- Native editable linear/radial gradient import with inherited definitions, transforms, spread modes, translucent stops, direct canvas handles, and grouped timeline animation.
- `DOMParser` ingestion for groups, paths, rectangles, circles/ellipses, lines, polylines, polygons, and basic text.
- Full path-command normalization for absolute/relative line, cubic, shorthand, quadratic, elliptical-arc, and close commands.
- Unsupported safe SVG nodes survive as sanitized source through save, reload, editor rendering, and static export.
- Clean static SVG export with an option to bake rounded path corners.
- Canvas pan/zoom, rulers, draggable numeric guides, guide expressions, and guide locking.

## Artwork editing

- Pen-authored open and closed paths with straight and cubic segments.
- Rectangle, ellipse, and multiline text elements.
- Alpha-aware fill/stroke color picking, caps, joins, rectangle corner radius, element opacity, visibility, and locking.
- Direct linear/radial gradient handles plus compact stop popovers in Properties and Animate modes.
- Element translate, scale, rotation, and editable transform origin.
- Direct path editing: anchors, mirrored/broken bezier handles, segment selection, point insertion/deletion, straight/curve conversion, and rounded anchors.
- Compound paths with multiple contours and even-odd/nonzero fill rules.
- Precise and optimized stroke-to-path conversion, including caps, joins, closed strokes, and curve-native boolean cleanup.

## Layers and composition

- Recursive layer tree with selection, range/multiple selection, rename, drag ordering/reparenting, duplicate, visibility, lock, and delete.
- Groups, ungrouping, nested rendering, and clipping masks.
- Combine selected paths while preserving world-space geometry.
- Motion-path attachment and detachment.

## Animation

- Versioned animation document with duration, loop, tracks, markers, and runtime-variable storage.
- Edit/animate modes, playback, scrubbing, timeline zoom/fit, nested rows, and per-property tracks.
- Keyframe add/remove, multi-selection, marquee, drag/nudge, copy/paste/delete, and easing choices.
- Numeric, boolean, string, and color evaluation; deterministic interpolation and preview base-state restoration.
- Animatable transforms, visibility, opacity, fill/stroke, stroke width, draw progress, motion progress/orientation/offsets, and path-point positions.

## Current limits

- Animated/runtime publishing is not shipped yet.
- Complex imported transforms with skew, patterns, effects, rich text, and other non-native features are preserved but are not directly editable.
- Multi-layer canvas marquee and multi-object transforms are not yet available.
- Boolean editing is currently used by stroke conversion rather than exposed as a complete user-facing boolean toolset.
- Patterns, images, masks, filters, reusable symbol semantics, rich text, embedded fonts, and accessibility metadata remain planned.
- Expressions, physics, constraints, bones, and IK remain planned.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership rules and [SVG_COMPATIBILITY.md](SVG_COMPATIBILITY.md) for element-level coverage.
