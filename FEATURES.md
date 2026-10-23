# Shipped Features

SVG Animator is a motion SVG studio: a browser-based drawing, editing, and keyframe-animation workspace. This file records shipped behavior; planned work lives in [ROADMAP.md](ROADMAP.md).

## Documents and persistence

- Multi-document tabs with per-document undo/redo history. Unchanged identity, artwork, animation, and guide sections are shared across entries; history retains up to 50 entries and 64 MiB of unique section data.
- Asynchronous local project gallery, explicit loading/error states, dimension presets, and versioned document envelopes.
- IndexedDB persistence separates project metadata, documents, and thumbnails. A one-time localStorage migration retains a read-only legacy backup; localStorage and then in-memory repositories are used if IndexedDB is unavailable.
- Coalesced autosaves write only the newest pending revision. Artwork thumbnails are generated during idle time and animation-only edits reuse the existing thumbnail.
- Safe SVG file import from the project gallery with editable/preserved/removed-content reporting.
- Editable Project JSON import as a new copy, with legacy migration, file validation, preserved-source sanitization, and no overwriting of existing projects.
- Session Undo for gallery deletion, including multiple deletions and keyboard focus restoration; recovery remains available until the tab reloads or closes.
- Native editable linear/radial gradient import with inherited definitions, transforms, spread modes, translucent stops, direct canvas handles, and grouped timeline animation.
- `DOMParser` ingestion for groups, paths, rectangles, circles/ellipses, lines, polylines, polygons, and basic text.
- Full path-command normalization for absolute/relative line, cubic, shorthand, quadratic, elliptical-arc, and close commands.
- Unsupported safe SVG nodes survive as sanitized source through save, reload, editor rendering, and static export.
- Project-card actions for deterministic editable Project JSON export and deletion, plus a sectioned editor publishing dialog for Static SVG, Embedded Animation SVG, self-contained Animated SVG, Runtime Assets ZIP, and Web Bundle ZIP exports with deterministic runtime JSON, markup, manifests, filenames, and build diagnostics.
- Canvas pan/zoom, rulers, draggable numeric guides, guide expressions, and guide locking.

## Artwork editing

- **New artwork defaults** appear in the top bar while a drawing tool (Pen, Line, Rectangle, Ellipse, Arc, Create shape) is active: Fill and Stroke chips, swap, and a stroke width (default 2) for new rectangles, ellipses, Pen paths, Lines, Arcs, and built regions. A chip opens a popover that reuses HEX/RGB/HSL/alpha controls, project colors, and the eyedropper, with Apply/Cancel, Escape or outside-click cancellation, and no paint. Defaults persist across reloads independently of selection and document history. New drawings start with teal fill/stroke; open paths use only the stroke, and closing a Pen path enables its captured fill. Invisible styles (including a zero stroke width) display a warning; changing defaults never restyles existing artwork.
- **Eyedropper** is available in every shared color editor: drawing defaults, solid paints, text, gradient stops, and timeline colors. Choose **Artwork** for displayed canvas colors or **Reference** for original source pixels, ignoring tracing opacity and overlapping artwork. Locked references work; hidden references are unavailable. A magnifier and color value preview the pick; click/Enter applies, arrows move (Shift for larger steps), and Escape cancels with focus restored. Picks use the existing color/palette path and commit as one undoable edit; drawing defaults remain drafts until Apply. Sampling stays within the canvas and rejects transparent reference pixels and letterboxing.
- **Project colors** is one project-specific palette shared by drawing defaults, solid paints, gradient stops, and timeline paint controls. It collects authored fills, strokes, text colors, gradient stops, and color keyframes, including hidden/locked artwork, plus committed drawing-color choices. Colors deduplicate by RGB and alpha; no paint is not a swatch. Newly used colors move forward; pinned favorites stay first. **Manage colors** names/pins swatches; names commit on Enter or blur and Escape discards a name draft. Colors remain after artwork deletion, survive reload/Project JSON, and undo with the originating edit. Default-color swatches preview in the drawing-default popover until Apply. All palettes refresh together; playback and canceled drafts do not add colors. Swatches copy values rather than linking artwork.

- One embedded PNG/JPEG/WebP tracing reference per project, beneath the artwork. Add it from the **Tracing reference** (image) button in the top bar, which opens a panel that stays open while you adjust the reference on the canvas; paste a copied image/screenshot with Ctrl/Cmd+V over the canvas or **Paste image**, fade/hide it, unlock to drag or proportionally resize (pointer, numeric fields, or arrow keys), fit to the canvas, then lock for tracing. Placement handles remain outside the artboard; Escape/blur cancels a gesture. Reference changes undo/redo and survive reload and Project JSON round trips. Artwork exports and thumbnails omit the reference.

- Pen-authored open and closed paths with straight and cubic segments.
- Rectangle, ellipse, and multiline text elements.
- Grouped drawing tools: Paths contains Bézier/Pen and standalone Line (click endpoints or drag; Shift for 15° angles). Shapes contains Rectangle, Ellipse/Circle (Shift for circles, Shift+Alt to draw from the center), and circular Arc (center, start/radius, end; Shift for the complementary long arc). Lines share pen tangent/perpendicular snapping. Arc endpoints project onto the established radius; completed arcs are editable cubic paths using the SVG-import converter. Previews, center/radius guides, Enter completion, Escape/blur cancellation, and one-step undo keep construction reversible. Palette choices support keyboard focus/activation.
- **Shapes → Create shape:** preview/select enclosed regions from overlapping paths, circles/ellipses, rectangles, and arcs; merge selected regions into an editable filled path while retaining holes and source outlines. **Paths → Trim:** independently preview and remove outline spans between intersections, leaving editable open contours. Without intersections, trimming removes the whole contour. Both support selection-only scope, cancellation, and undo/redo. Native shapes become cubic paths when trimmed; ellipse arcs use compact quarter-turn-or-smaller segments (two Béziers for a semicircle), and tangent contacts split spans regardless of line direction. Open results retain stroke styling (fill-only sources use their fill color as a stroke).
- Curve endpoint tangent snapping aligns Bézier endpoints and their adjacent handles to native circles/ellipses while drawing or moving an existing open endpoint. Existing handle length is preserved. Common tangent snapping adjusts both endpoints of a Line or the first straight Pen segment between two ellipses, including crossing tangents when possible. Alt bypasses both behaviors.
- Alpha-aware fill/stroke color picking, center/inside/outside alignment, authored dashes and offset, caps, joins, miter limits, rectangle corner radius, element opacity, visibility, and locking.
- Direct linear/radial gradient handles plus compact stop popovers in Properties and Animate modes.
- Element translate, scale, rotation, and editable transform origin.
- Shared canvas/Layers multi-selection, modifier-click toggling, additive marquee selection, shared movement/proportional scaling/rotation, and full-selection undo/redo.
- Ctrl/Cmd+A selects editable top-level objects; Edit-mode arrows nudge by 1 unit, or 10 with Shift. Active canvas gestures finish outside the workspace and cancel with Escape or window blur.
- Multi-object animation gestures capture all targets before keyframe writes and commit as one history entry.
- Edit-mode object Copy/Paste and Paste in place across projects in the same app tab (Ctrl/Cmd+C, Ctrl/Cmd+V, Ctrl/Cmd+Shift+V). Copies preserve nested transform context, clipping, paints, motion dependencies, and animation channels with fresh IDs. The app clipboard lasts until reload.
- Six geometry-based alignment actions in the top bar whenever objects are selected (outside drawing tools), against the selection, canvas, or last selected object; equal horizontal/vertical gaps for three or more objects. Nested parents are respected and each action is one undo step. Curves align by their extrema; strokes/effects are excluded.
- Object-move snapping to geometric edges/centers of visible artwork, locked or unlocked guides, and canvas bounds. A remembered magnet toggle, immediate Alt bypass, stable screen-pixel acquisition/release, target outlines, and relationship labels support single and multi-object moves in Edit and Animate modes. Motion-driven selections are excluded.
- Pen placement and existing-anchor movement snap to path anchors, straight midpoints, and cubic midpoints (`t = 0.5`), including compound contours and implicit closing edges. Circle/diamond markers identify targets; guides and canvas bounds provide fallback alignment. The same magnet controls point snapping. Hold Alt to bypass in the pen, or press it after starting an anchor move; Alt before an anchor drag still converts its handles.
- Snapped anchor drags preserve attached handles and nested transforms, support one-step undo and Animate key capture, and restore exact geometry on cancellation or no-op completion. Snapping across paths keeps their point identities independent.
- Pen and anchor snaps slide along straight/cubic path interiors and capture intersections without existing anchors, including self-crossings and isolated tangent contacts. Square markers identify interior locations and crosses identify intersections. Discrete anchors/midpoints/intersections take priority over sliding; coincident overlaps remain ordinary path targets.
- Straight pen segments snap to tangent/perpendicular contacts on cubic paths and perpendicular feet on straight segments. Contact symbols and labels identify the relationship; Alt bypass and the shared magnet remain available. These are placement aids, not persistent constraints.
- Native circles and ellipses provide tangent and perpendicular contacts for Line and straight Pen segments, including nested rotation, reflection, shear, and nonuniform scale. Perpendicular contacts are solved in canvas space; finite contacts inside an ellipse are supported, while zero-length contacts and a circle-center continuum are excluded. References remain native shapes; no path conversion is required.
- Single/shared rotation snaps actual straight path edges and rectangle sides into parallel alignment, with 3° acquisition and 5° release. Rounded rectangles contribute their straight side spans. Nested transforms, locked references, stationary Alt bypass, custom origins, undo, and Animate capture are supported within existing rotation limits. Multi-object Shift rotation retains 15° increments.
- Workspace-level editor controls extend beyond the artboard with stable screen sizing, hover feedback, handle tooltips, selected-anchor emphasis, and resize cursors that follow projected transforms. Path segments retain a 12-pixel hit stroke even when selected.
- Direct path editing: anchors, mirrored/broken bezier handles, segment selection, point insertion/deletion, straight/curve conversion, and rounded anchors. Corner radii work at closed-path joins and on straight edges stored as Béziers with collapsed or collinear handles; curved edges remain ineligible.
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
- The object clipboard is app-session-only; operating-system clipboard exchange and cross-browser-tab paste are not yet available. Nested copies retain ancestor groups with fixed base origins, so omitted animated siblings no longer influence those origins.
- Anchor/interior/intersection snapping currently targets paths, excluding clipped groups, rounded vertices, and adjoining segments. Native-shape interiors/intersections and stroke outlines remain future work. Motion-driven anchors cannot be dragged; Bézier-handle and segment drags do not use the new point snapping. Intersection snapping does not split paths or create shared topology.
- Tangent/perpendicular construction supports straight pen segments, with native ellipse curve-endpoint and common-line tangency also available; existing-segment constraint editing remains planned. Edge rotation excludes clipped geometry, curved path segments, and motion-driven moving geometry.
- Region creation uses boolean union; a complete object-level boolean toolset remains planned. Region/trim scopes skip hidden, locked, clipped, motion-driven, and directly animated sources, with a 600-source-curve limit. Construction ellipses use high-precision cubic approximations; analytic tangency remains exact. Gap closing and drag-to-paint region/trim selection remain planned.
- Patterns, images, masks, filters, reusable symbol semantics, rich text, embedded fonts, and accessibility metadata remain planned.
- Expressions, physics, constraints, bones, and IK remain planned.

See [ARCHITECTURE.md](ARCHITECTURE.md) for ownership rules and [SVG_COMPATIBILITY.md](SVG_COMPATIBILITY.md) for element-level coverage.

Multi-object scaling is proportional. Rotation across differently scaled parent groups and shared transforms involving motion-path attachments are unavailable; the selection summary explains these limits.
