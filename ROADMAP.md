# Product Roadmap

SVG Animator is a browser-based motion SVG studio. The overhaul prioritizes making artwork easy to arrange, shapes easy to construct, and animation easy to understand and refine. Features are grouped by shared mechanics so each improvement supports the next.

This is the source of truth for planned work and delivery order. [FEATURES.md](FEATURES.md) records shipped behavior, [ARCHITECTURE.md](ARCHITECTURE.md) defines ownership, and [SVG_COMPATIBILITY.md](SVG_COMPATIBILITY.md) tracks SVG coverage. Novelty modes and the earlier silly-feature category are excluded. Useful techniques such as springs, squash/stretch, stagger, and follow constraints remain ordinary animation tools.

## Delivery order

Each stage ships as focused, reviewable changes. Stages are a sequence, not a promise to implement every item in one pass.

| Stage | Scope | Outcome |
|---|---|---|
| Foundation | Handle visibility and interaction polish; preserve the existing workspace overlay | Controls are understandable and reliable around the artboard |
| A Comfortable creation | Project restore, recoverable deletion, canvas multi-selection, clipboard, basic alignment and snapping | Build and arrange a scene with less friction |
| B Precision drawing | Path snapping, edge rotation, tangent/perpendicular snapping, reference tracing, region building and trimming | Construct clean artwork from simple geometry |
| B2 Color tools | Active fill/stroke colors, unified project color palette, artwork/reference eyedropper | Color complex artwork consistently and reuse colors quickly |
| C Motion refinement | Onion skins, motion trails, keyframe retiming, ping-pong, loop inspection | See and correct timing and motion |
| D Animation tools | Presets, stagger, springs, squash/stretch, deterministic variations, bake | Create appealing motion quickly and retain editability |
| E Reusable resources | Linked styles, repeaters, symbols, shared asset and animation libraries | Reuse and extend artwork and motion |

Appearance and publishing improvements accompany the stage that needs them. Project safety and accessibility are ongoing requirements throughout the sequence. Larger expansions remain in the deferred section below.

**Next delivery: motion-refinement foundation** (onion skins and motion trails). The requested color-tools delivery is complete.

## Completed implementation slices

### Shared artwork/reference eyedropper — October 23, 2026

- Every shared color editor exposes one eyedropper for drawing defaults, paints, text, gradient stops, and timeline colors. Artwork samples the rendered canvas; Reference samples original image pixels independently of tracing opacity and overlapping artwork, including locked references.
- Added a magnified preview, color value, source switch, click/Enter selection, arrow-key movement, focus trapping/return, and Escape cancellation. Sampling respects placement, zoom/pan, nonzero viewBox, letterboxing, and alpha; transparent or out-of-bounds samples do not apply.
- Sampling pauses playback and cancels on context changes or owner destruction. Confirmed picks route through existing color owners and flush their coalesced edit immediately for one-step undo; previews and canceled drafts do not collect palette colors. No document migration or browser-specific screen picker required.
- Verified 66 focused sampling and adjacent paint/palette/reference/timeline tests, plus browser source switching, keyboard and pointer selection, cancellation, focus return, palette reuse, and immediate undo/redo. Production build and diff checks passed. Artwork raster resolution is capped at 4096 pixels per side; references retain original source pixels.

### Unified Project colors — October 23, 2026

- One project-owned palette combines committed choices and authored fill, stroke, text, gradient-stop, and animation colors. Color/alpha deduplication, recent-use ordering, names, and pinned favorites share one UI across drawing defaults, Properties, and timeline paint controls. No separate Recent section.
- Collected colors remain available after artwork deletion. Collection runs with the originating document commit; palette metadata and artwork undo together, while playback and canceled drawing-color drafts do not add entries. Drawing defaults remain independent preferences; their palette entries are document-owned.
- Document envelope v7 adds optional validated project colors, with v6 migration and Project JSON/reload coverage. Artwork export/runtime formats remain unchanged. Fixed redo history so an edit after redo undoes to the restored state, and made the mutation revision reactive so all open palette surfaces refresh together.
- Verified 114 focused/adjacent palette, migration, persistence, paint, timeline, construction, reference, and history tests. Browser checks covered named/pinned colors, drawing reuse, gradient-stop reuse, live updates, undo/redo, and reload. Production build and diff checks passed.

Artwork/reference-image sampling followed this slice.

### Common drawing colors — October 23, 2026

- Added sidebar fill/stroke controls for new artwork, reusing HEX/RGB/HSL/alpha editing with explicit Apply/Cancel, Escape, swap, and no paint. Selection and existing artwork stay independent; invisible styles show feedback. Draft edits cancel on tool/document changes.
- Rectangles, ellipses, Pen, Line, Arc, and built regions share the drawing colors. Gestures capture colors at the start; open paths render stroke only, and Pen closure enables the captured fill. The initial drawing style is teal fill/stroke, replacing the earlier per-tool colors/unfilled-shape defaults; stroke widths remain unchanged.
- Preferences survive reloads outside document history. Model construction, import, restoration, duplication, and trimming retain their own paint behavior; no document schema change.
- Verified 105 focused/adjacent tests covering controls, preferences, creation, Pen snapping, paint editing, and characterization. Browser checks confirmed shared colors on rectangles/ellipses/lines, undo/redo, and saved colors/artwork after reopening. Production build and diff checks passed.

The unified Project colors palette and artwork/reference sampling followed this slice. Motion refinement follows the color-tools delivery.

### Native ellipse perpendicular snapping — October 23, 2026

- Line and straight Pen segments now snap perpendicular to native circles/ellipses, including rotated, reflected, sheared, and nonuniformly scaled references. The existing magnet, relationship feedback, screen-space capture/release, Alt bypass, and undo boundary are reused.
- Contacts solve the normal condition in canvas space. Finite interior-origin contacts and repeated roots are supported; zero-length connections, collapsed geometry, and the infinite family from a circle's center are excluded. Source ellipses remain native and unchanged.
- Extracted the existing polynomial root solver for reuse by cubic and ellipse contacts. No document schema changes.
- Verified 72 focused/adjacent geometry, Pen, Line, snapping, and overlay tests; browser checks confirmed a rotated ellipse's perpendicular preview, placement, and one-step undo/redo. Production build and diff checks passed.

Next: color tools, then motion-refinement foundation (onion skins and motion trails). Drag-to-paint regions/trim and gap controls remain drawing follow-ups.

### Trim and corner-radius follow-up fixes — October 23, 2026

- Ellipse trim/region output now uses compact editable arcs; a kept semicircle uses two Béziers rather than sixteen. Endpoint incidence handles either direction of a tangent line, so sequential trimming keeps both circles intact.
- Corner radius recognizes straight geometry stored as Béziers, including collapsed Pen handles. Closed paths include implicit closing edges and adjoining endpoints with separate identities. Editor geometry, export/runtime rendering, and stroke conversion agree without rewriting saved topology.
- Verified focused regression coverage for both circle trim orders, every corner of closed Pen paths, save/reload, undo/redo, and export. Production builds and diff checks passed.

### Curve joins, common tangents, region creation, and standalone trim — October 23, 2026

- Bézier endpoints acquire native circles/ellipses and align the adjacent handle to the analytic tangent. Existing endpoint drags preserve handle length and nested transforms; new Pen gestures preview the alignment while pulling handles. Alt bypasses it and cancellation restores the original geometry. These are geometric edits, not persistent constraints or curvature matching.
- Line and the first straight Pen segment support common tangents between two circles/ellipses. Start near the first outline, then approach a tangent contact on the second: both endpoints adjust together. External and crossing tangents are supported when they exist; Alt restores the freely placed starting point.
- **Shapes → Create shape** previews bounded regions formed by intersecting paths, circles/ellipses, rectangles, and arcs, including open construction lines. Click regions to toggle selection, then **Create shape** or Enter to merge them into one editable filled path. Original outlines remain; holes are retained.
- **Paths → Trim** is an independent outline editing tool. Hover to preview a span between intersections and click (or Enter on the preview) to remove it. With no intersections the span is the whole contour. Remaining pieces stay editable; trimmed native shapes become cubic paths with open contours. Stroke styling is retained; fill-only outlines gain a visible stroke. Each action has one undo entry.
- Both tools default to all eligible artwork, with **Selection only** to restrict the scope. Hidden, locked, clipped, motion-driven, and directly animated sources are excluded. Processing is bounded to 600 source curves; use smaller selections for dense artwork. Native ellipses use high-precision cubic outlines for construction; snapping retains analytic ellipses. No document schema change.
- Selected-object handles are hidden while creation/trim tools are active so resize targets cannot swallow placement clicks. Snap feedback remains visible. Escape, toolbar actions, mode/document changes, undo, and tool changes clear transient previews/selections.
- Browser checks covered common tangent placement, a region bounded by two circles and two tangents, standalone arc removal, trim undo/redo, and a new Bézier endpoint tangent join. 84 focused geometry, command, overlay, boolean/stroke characterization, and editor tests passed; production build and diff checks passed.

Follow-ups: drag-to-paint region selection/trim, gap-closing tolerance controls and further motion-refinement work. Native ellipse perpendicular snapping followed this slice.

### Line and arc construction, grouped drawing tools — October 23, 2026

- Paths groups Bézier/Pen and Line, with future freehand-to-path drawing planned in the same group. Shapes groups Rectangle, Ellipse/Circle, and Arc; the existing ellipse tool creates circles with Shift and centered circles with Shift+Alt, without a duplicate Circle tool. Lines support click-click and drag creation; arcs use center/start/end clicks or a center-to-start drag followed by an endpoint click. Shift constrains line angles to 15° and chooses the complementary long arc.
- Lines reuse point, intersection, tangent, and perpendicular snapping; arc centers/starts reuse eligible point/path snapping. Arc endpoints project onto the established radius without misleading off-circle snap feedback. Alt bypass refreshes with a stationary pointer.
- Construction remains a temporary preview until completion, with workspace origin/radius guides and stage instructions. Enter advances/completes; Escape, blur, cancellation, undo, document/mode changes, and tool switches discard incomplete geometry. No-op placement creates no history.
- `ConstructionDrawingService` owns gestures; `LayerOperationsService.insertElement` and `DocumentMutationService` own the final structural commit. Circles continue to use the existing ellipse tool. Arcs use a shared extraction of the existing SVG arc-to-cubic converter, preserving import behavior and serialization compatibility.
- Added accessible palette labels, keyboard activation, and ArrowRight to open tool choices. New line/arc strokes use the established shape accent for visibility on the artboard.
- Initial construction validation covered SVG import, snapping, overlay/editor integration, and browser drawing/undo checks. Palette regrouping passed 47 focused construction, preferences, snapping, overlay, and editor tests, including centered circles, sibling preview cleanup, saved tool restoration, and grouped Pen snap feedback; production build and diff checks passed.

Region selection/merging and independent edge trimming followed this slice (see above).

### Clipboard reference images — October 23, 2026

- Paste copied raster images/screenshots with Ctrl/Cmd+V over the canvas or the Tracing reference **Paste image** button. The panel opens automatically; the same fit, lock, validation, persistence, and undo boundary handles files and clipboard images.
- Native clipboard routing preserves text editing and object copy/paste, prioritizes image bytes over stale copied objects, and retains Shift+paste in place. Clipboard read failures offer the native paste/file-picker fallback; empty clipboards leave the document unchanged.
- Verified with 37 focused reference, clipboard routing, object arrangement/paste, and editor tests, production build, and browser checks for both image-paste entry points, undo, and subsequent object copy/paste.

### Tracing reference foundation — October 23, 2026

- Added one embedded PNG/JPEG/WebP reference beneath the artwork, with 40% default opacity and placement locked for immediate tracing.
- The sidebar's Tracing reference section supports replacement, opacity, visibility, removal, proportional numeric sizing, and fit to canvas. Unlocking exposes workspace move/resize controls with keyboard nudges; Escape, pointer cancellation, and blur discard the gesture draft.
- Every edit commits through the document mutation boundary. Project envelope v6 preserves references across reload and Project JSON round trips; separate source/placement history sections avoid duplicating image bytes during adjustments.
- SVG exports, runtime bundles, and thumbnails omit references. Import accepts embedded raster images up to 10 MB; remote URLs and SVG reference payloads are rejected.
- Verified with 44 focused reference/persistence/import/export/editor tests, production build, and browser checks for first import, undo/redo, move, resize, opacity, locked tracing, and reload.

Line and arc tools, alongside existing ellipse/circle drawing, followed this slice. Intersection splitting, region previews, and edge trimming are next.

### Native circle and ellipse tangents — October 23, 2026

- Straight pen segments now acquire both tangent contacts on native circle/ellipse objects, without converting them to paths. The exact affine ellipse is retained through nested rotation, reflection, and nonuniform scale.
- Uses the existing magnet, Alt bypass, feedback, and screen-space hysteresis. Visible locked references are eligible; hidden and clipped references remain excluded. Origins inside/on the outline and collapsed ellipses do not produce finite tangent targets.
- Native ellipse perpendicular snapping followed in a later slice; interior and intersection snapping remain separate follow-ups. No document schema or reference geometry changes.
- Verified 53 focused ellipse/contact/path/pen/rotation/overlay tests, production build, and whitespace checks. Browser verification confirmed the tangent preview, exact committed contact, unchanged native ellipse, and clean console output.

### Tangent/perpendicular placement and edge rotation — October 23, 2026

- Straight pen segments acquire tangent and perpendicular contacts on eligible cubic paths, plus perpendicular feet on straight segments. Contacts are computed from the current segment's fixed start in canvas space and use the existing 6-pixel acquisition/10-pixel release tolerance. Dedicated symbols and relationship labels distinguish these constraints.
- Contacts remain independent points; they do not establish a persistent constraint or split the reference path. Continuing a curved segment or dragging a Bézier handle does not claim straight-line tangency. Existing anchors/intersections keep priority when multiple relationships occupy the same point. Undefined cusp directions, zero-length construction lines, and infinite continua are excluded.
- Single and multi-object rotation aligns straight path edges and actual rectangle sides to visible reference edges, including locked references. Rounded rectangles contribute only their remaining straight side spans. Angular capture/release is 3°/5°, modulo 180°; Alt bypass updates immediately, and the shared magnet controls the feature. Existing Shift-to-15° increments for multi-object rotation take precedence.
- Alignment is solved in the gesture's parent/frame coordinates, including reflection and nonuniform parent scale. Motion-driven moving geometry and clipped geometry are excluded; existing shared-rotation availability limits remain. Feedback highlights both aligned edges in the workspace overlay.
- Rotation now consistently uses an object's custom transform origin. Completed gestures retain one history entry and Animate key capture; cancellation and no-op completion restore exact baselines and automatic origins.
- Verified 78 focused contact/geometry/pen/rotation/selection/overlay tests, production build, and whitespace checks. Browser checks confirmed tangent and perpendicular previews, tangent placement, exact 30° edge alignment, one-step undo, and clean console output. Full-suite testing remains for the final overhaul pass.

Next slice: reference images and construction shapes, followed by enclosed-region building and edge trimming. Native ellipse tangents followed this slice; native ellipse perpendicular contacts followed later; tangent/perpendicular editing of existing segments and persistent geometric constraints remain follow-ups.

### Path interiors and intersections — October 23, 2026

- Pen placement and existing-anchor drags now snap anywhere along eligible straight/cubic path segments, and to crossings without existing anchors. Queries include line/line, line/curve, curve/curve, self-crossings, and isolated tangent contacts.
- Interior captures slide along the segment with the existing 6-pixel acquisition/10-pixel release tolerance. Nearby anchors, midpoints, and intersections take priority over sliding; discrete targets retain their existing hysteresis. Squares mark path locations and crosses mark intersections in the shared overlay.
- Geometry is frozen in canvas space, preserving nested transforms and the existing moving-anchor/adjacent-segment exclusions. Queries reuse the installed Paper curve engine without creating scene items; nearby segment bounds filter intersection work and solved pairs are cached for the session.
- Coincident overlaps do not produce arbitrary intersection targets; their interiors remain snappable. Clipped groups, rounded vertices/adjacent segments, native shapes, and stroke outlines retain the prior limits. Snapping neither splits reference geometry nor welds point identities.
- Verified 80 focused geometry, pen/anchor, selection, object-snap, overlay, and editor characterization tests with the same Paper engine loaded by the app. Production build and whitespace checks passed. Browser checks confirmed intersection preview/placement, sliding anchor placement, one-step undo, and clean console output.

Tangent/perpendicular placement and flat-edge rotation followed this slice. Reference-guided regions and edge trimming are next, starting with reference images and construction shapes.

### Path anchor and midpoint snapping — October 23, 2026

- Pen placement and existing-anchor drags snap to visible path anchors, straight-segment midpoints, and cubic midpoints at parameter `t = 0.5`. Compound contours and implicit closing edges are included; visible locked paths remain usable references. Snapping to another path creates independent points rather than welding their topology.
- Point targets capture both coordinates together, with the same 6-pixel acquisition and 10-pixel release as object moves. Guide/canvas snapping remains the fallback. Circles identify anchors and diamonds identify midpoints, with fixed-size labels in the shared workspace overlay.
- The existing magnet controls both object and point snapping. Alt bypasses pen snapping; during anchor movement, press Alt after starting the drag to bypass. Alt held before an anchor drag retains the existing handle-conversion behavior.
- Anchor gestures preserve the pointer grab offset, move attached handles together, and respect nested rotation/reflection. Edit and Animate gestures commit once; Escape, blur, and no-op completion restore exact geometry and origins.
- Pen clicks keep their snapped preview through mouse release. A snap offset no longer turns a click into an accidental curve, and resuming an unfinished path no longer drops its working segment. Closing tolerance now stays consistent across zoom.
- This slice targets paths. Clipped groups, rounded vertices, and segments adjoining rounded vertices are skipped until rendered-outline queries are available. Moving anchors on motion-driven paths/ancestors is unavailable; Bézier-handle and segment drags retain their existing behavior.
- Verified 86 focused path/pen/snapping/transform/selection/overlay/editor tests, then 35 focused regressions after the final release-lifecycle fix. Production build and whitespace checks passed. Browser checks confirmed midpoint placement, anchor-to-anchor movement, one-step undo, and clean console output. Full-suite testing remains for the final overhaul pass.

Path interiors/intersections, tangent/perpendicular placement, and flat-edge rotation followed this slice. Reference-guided region building and trimming follows those precision tools.

### Object move snapping — October 23, 2026

- Single objects and selections snap their geometric edges/centers to visible artwork, guides, and canvas edges/centers. Visible locked artwork and locked guides remain references; moving objects, their descendants, and their ancestors are excluded.
- The header magnet toggles snapping and remembers the editor preference. Holding Alt bypasses snapping immediately, including with a stationary pointer. Resize, rotate, anchor editing, and keyboard nudging retain their existing behavior.
- Targets acquire within 6 screen pixels and release beyond 10, retaining the same relationship between nearby candidates. Passive workspace overlays show guide lines, target bounds, and relationship labels with fixed screen sizing.
- Nested transforms share the existing arrangement geometry. Clipped groups act as one target using intersected geometry bounds; strokes/effects are excluded. Snapping is unavailable for moving motion-path-driven selections or groups containing motion-driven descendants.
- Edit and Animate moves keep their existing one-gesture mutation boundary. Escape/blur and no-op completion restore exact geometry and ancestor origins; snapping preferences do not create document history.
- Fixed ruler measurement order on fresh canvases and stabilized viewport culling during Edit/Animate layout changes.
- Verified with 67 focused snapping/transform/selection/arrangement/overlay/preferences/ruler/editor tests, a production build, and browser checks for exact edge/top alignment, disabled snapping, keyboard toggling, and mode changes. Full-suite testing remains for the final overhaul pass.

Anchor/midpoint, path-interior, intersection, tangent/perpendicular, and flat-edge rotation snapping followed this slice.

### Object clipboard and arrangement — October 23, 2026

- Edit-mode Copy, Paste, and Paste in place work across documents and editor navigation in the same app tab. Ctrl/Cmd+C/V and Ctrl/Cmd+Shift+V are scoped to objects in Edit mode; Animate mode retains keyframe clipboard shortcuts and text inputs keep native behavior.
- Clipboard snapshots preserve draw order, nested ancestor transforms/opacity, clipping, shared path points, gradients, motion-path dependencies, and animation channels. Every paste remaps IDs and preserved SVG resource references. Referenced paths outside the selection are included hidden; pruned ancestor origins are pinned to the copied base state.
- Normal paste advances by 10 document units per paste; paste in place retains original canvas coordinates. Animation offsets remain consistent during playback. Destination duration extends when copied keys need more time. Each paste is one undoable structural mutation.
- Selection controls offer left/center/right/top/middle/bottom alignment to selection, canvas, or the last selected object. Equal-gap spacing keeps the outer objects fixed and requires three objects. Nested parent transforms, inherited locks, no-op completion, and one-step undo share the existing selection/mutation owners.
- Arrangement measures curve extrema and transformed ellipses, separately from existing transform-origin bounds. Strokes/effects are excluded. Motion-path arrangements remain disabled, as with shared transforms.
- Fixed fresh-project dialog/canvas initialization errors discovered while checking cross-project paste. Artwork and overlay references now share one template scope while retaining their sibling layout.
- Verification uses focused clipboard, arrangement, selection, Properties, timeline/page shortcut, SVG import, and fresh-project lifecycle tests, plus production build and browser interaction checks. Full-suite checks are reserved for the final overhaul/release pass.

Object/guide move snapping followed this slice. System clipboard exchange, cut, and persistent clipboard history remain later work.

### Shared canvas selection and transforms — October 22, 2026

- Canvas and Layers now share one ordered selection. Shift/Ctrl/Cmd-click toggles objects; dragging empty workspace starts an intersecting marquee, with modifiers to add. Marquee selects whole top-level groups.
- Shared outlines and handles move, proportionally scale, and rotate multiple objects around one pivot. Selecting both a parent and its descendant transforms the parent only. Inherited visibility/locks are honored.
- Nested objects use their parent coordinate systems. Siblings rotate in their shared parent space; cross-parent rotation is unavailable when it would require unsupported skew. Multi-object scaling is proportional; motion-path selections require detaching before a shared transform. The Properties summary explains restrictions.
- Ctrl/Cmd+A selects editable top-level objects. Arrow keys nudge 1 document unit in Edit mode, or 10 with Shift. Animate-mode arrows retain keyframe retiming.
- Escape and window blur cancel canvas transform/marquee gestures. Release outside the workspace finishes an active drag. No-op gestures leave no history entry.
- Completed gestures use the existing mutation boundary once. History restores the full selection by ID; animation capture reads all selected targets before writing any keyframes.
- Verified all 247 tests, the production build, and whitespace checks, including selection, transformed-parent, reflection, cancellation, history, and animation regressions; browser marquee, shared movement, scaling, rotation, and undo.

Followed by clipboard, alignment, and basic object snapping above. Persistent trash and whole-library backups remain later safety work.

### Project import and deletion recovery — October 22, 2026

- The gallery accepts SVG and exported Project JSON through one import action.
- Project import validates the file, applies existing migrations, preserves internal artwork/animation IDs and editable source, and generates a thumbnail through the shared renderer.
- Every JSON import receives a new project ID; duplicate names gain an imported-copy suffix. Existing projects are never overwritten.
- Unsupported versions and malformed artwork fail before saving. Preserved SVG fragments use the same sanitizer as the rendering boundary.
- Gallery deletion offers an Undo stack for the current tab session, without a timer. Recovery preserves artwork, thumbnails, timestamps, and gallery position. Reloading or closing the tab clears recovery; the UI states this limit.
- Saves, thumbnail updates, deletes, and restores use one serialized repository queue. An intentionally empty gallery stays empty after reopening.
- Verified all 232 tests, the production build, and whitespace checks, plus browser import, keyboard Undo, focus restoration, and playback of the restored animation.

### First handle visibility and usability pass — October 22, 2026

The artwork and transform/path/gradient controls already occupy sibling SVG surfaces. Controls project into workspace pixels and can extend beyond the artboard and artwork clipping masks. Keep that architecture; clip editor UI at the workspace boundary so it stays under surrounding panels and rulers.

- Preserve a 12 CSS-pixel segment hit stroke when a segment is selected; the visible selected stroke is only 2.5 pixels wide.
- Add segment hover feedback without letting the visible highlight intercept input.
- Add resize cursors that follow projected rotation and reflection, including parent transforms.
- Clarify transform, anchor, Bézier, and gradient handles with hover cues, contrast, selected-anchor fill, and accurate tooltips.
- Keep existing geometry, keyboard commands, gesture ownership, export output, and serialized documents compatible.
- Verified actual browser hit testing outside the artboard at 50%, 100%, and 200% zoom, selected-segment interaction, projected cursors, all 215 tests, the production build, and whitespace checks. Visually checked the local editor with the favicon starter project.

Follow-up overlay work: larger point/control hit areas with deliberate overlap priority, keyboard/focus access to controls, pointer-loss/cancellation audit, and the shared presentation of snap guides, measurements, and motion trails. These are not included in the first slice.

## Selection arrangement and snapping

Shared mechanics: selection state, geometry queries, coordinate projection, transforms, and temporary guide feedback. Extend the existing selection/domain owners; canvas and Layers must agree on the selected set.

First delivery:

- **Shipped:** canvas marquee and shared move/proportional-scale/rotate, with the transform limits described above.
- **Shipped:** app-session object copy/paste between documents, including paste in place.
- **Shipped:** align against the canvas, selection, or last selected object; distribute equal gaps within the selection.
- **Shipped:** moving-object edges and centers snap to artwork, guides, and canvas bounds.
- **Shipped:** pen placement and existing-anchor movement snap to path anchors/midpoints.
- Equal-gap snapping remains to do.
- Select underneath overlapping objects and repeat the last transform.
- **Shipped:** compact snapping control, highlighted targets, relationship labels, Alt bypass, and stable acquisition/release.

Next delivery:

- **Shipped:** snap to path interiors and intersections, including intersections without existing anchors.
- **Shipped:** tangent/perpendicular placement for straight pen segments; single/shared rotation aligns flat edges, within the limits above.
- Temporary extension lines and configurable grid/angle snapping.
- Target scope and candidate cycling; reuse the shipped acquisition/release hysteresis.
- Lasso, selection filters, property matching, and distance/angle measurements.

Acceptance: screen-space tolerances stay consistent across zoom; transformed groups resolve correctly; moving objects do not snap to themselves; one completed gesture creates one history entry; Escape restores the baseline and no-op completion creates no change.

## Drawing and path editing

Shared mechanics: contour topology, curve evaluation, intersections, and geometry-preserving mutation. Reuse the existing path helpers and boolean support used by stroke conversion.

First delivery:

- Line, polygon, star, arc, and donut creation tools.
- Join endpoints, split segments, reopen contours, and convert primitives to paths.
- Expose union, subtract, intersect, exclude, and divide operations.
- Build the reference-tracing and shape-builder workflow below after tangent/perpendicular placement and flat-edge rotation.

### Reference tracing, region building, and trimming

Requested workflow: place a reference image, trace its construction with overlapping lines, circles, and arcs, then select the enclosed regions to keep and trim unwanted edges. Schedule this after tangent/perpendicular snapping and flat-edge alignment so construction geometry is quick to place accurately.

1. Reference images are implemented as editor-only document aids, embedded in Project JSON and excluded from artwork exports. Line and arc construction tools are implemented alongside existing ellipse/circle drawing.
2. Implemented: split construction geometry at intersections to identify enclosed regions, including boundaries made from open curves; shared Paper adapters and boolean owners retain editable geometry.
3. Implemented: preview regions on hover, click to toggle them, then merge into an editable filled path. Holes and compound contours are preserved; Cancel discards the selection. Drag-to-paint and gap highlighting remain follow-ups.
4. Implemented: independent Trim previews spans between intersections and removes them as one undoable edit. Region creation keeps original construction geometry; layer visibility can hide it.

Acceptance: accurate intersections under nested transforms; deterministic handling of tangent contacts, overlaps, tiny regions, and gaps; keyboard/focus access to keep/discard actions; cancellation and undo restore originals. Define how splitting/merging affects animated points before enabling destructive topology edits on animated artwork.

Next delivery:

- Freehand/pen-to-path drawing with adjustable smoothing and stabilization, grouped with Bézier/Pen and Line in Paths.
- Curve creation with less manual handle management.
- Simplify paths with a live error-tolerance preview.
- Mirror/symmetry drawing and editable offset paths.

Acceptance: preserve transforms, compound contours, fill rules, and shared point identity; define how topology changes affect animated anchors and report unsupported cases before applying changes.

## Color tools for creating artwork

Shared mechanics: paint editing, drawing defaults, reusable color values, document color discovery, and coordinate-aware sampling. Extend the existing `PaintEditorComponent`, `ColorAttribute`, and `PaintEditingService`; reuse the gradient preset owner for existing gradient presets. Active fill/stroke defaults, the unified Project colors palette, and artwork/reference sampling are shipped. Recent choices and project colors share one palette, as requested October 23, 2026; there is no separate Recent section or global recent-color store.

First delivery, implemented in this order:

1. **Shipped: active fill and stroke colors.** Persistent, easily accessible controls for the colors used by new artwork, with a clear active target, swap, and no-paint actions. Closed shapes and created regions use the active fill/stroke; Line, Arc, and open Pen drawing use the active stroke, preserving stroke width. Creation defaults remain distinct from editing selected artwork so changing selection does not silently overwrite the drawing colors. Invisible drawing styles show explicit feedback.
2. **Shipped: Project colors, one reusable palette.** Combines colors already authored in the current project with committed color choices in one deduplicated palette, shared by drawing defaults, fill, stroke, and gradient-stop controls. Discovers fill, stroke, text, gradient-stop, and color-keyframe values, including hidden and locked artwork. Includes committed typed, adjusted, and swatch-applied choices; sampling uses the same path. Coalesced edits collect the committed value, not every input event or playback frame. Newly used colors move forward; named/pinned favorites remain first. Collected colors remain after their last artwork use is removed. Alpha is visible and no paint is distinct from transparent color. The palette saves with Project JSON and restores on reload; each project keeps its own colors. Ordinary application copies a color value. Linked swatches and global recoloring remain a later extension with explicit shared-edit semantics.
3. **Shipped: Eyedropper for artwork and reference images.** Start from the fill, stroke, or gradient-stop target and preview the sampled color before committing. Provide a visible choice between the artwork's displayed color and the original reference-image color. Reference sampling reads source pixels independently of tracing opacity and overlapping artwork, respects reference placement and canvas zoom/pan, and works with locked references. Show a magnified sample and color value; out-of-image and fully transparent samples must not invent a color. Core in-editor/reference sampling must work without relying on a browser-specific screen eyedropper; broader screen sampling is an optional enhancement.

Example workflow: paste a reference, sample its original colors into Project colors, set a common fill/stroke, construct and trim shapes, then reuse the same palette for details and gradient stops.

Ownership and interaction requirements:

- Drawing defaults remain editor preferences; the unified palette, saved names/pins, and reuse ordering belong to the document. Derive currently used colors from authored data and merge them with retained choices for one palette view; do not maintain a second recent-color store. Capture palette additions alongside the originating edit in the same document mutation, without an extra undo step. Choosing a drawing default adds to the current project's palette only when a project is open.
- Sampling owns temporary preview state and converts workspace coordinates to image pixels through the existing reference placement. Shared color controls expose the same reuse/sampling interactions wherever their capabilities allow them, including timeline color controls.
- Persistent artwork and palette edits use `DocumentMutationService`; animated color edits retain existing Animate-mode behavior. Adding saved palette data requires compatible defaults, document validation, and migration/round-trip coverage as appropriate. Editor palettes and references stay out of artwork exports.
- Pointer and keyboard activation, focus return, Escape cancellation, tool/document switches, no-op completion, and one undo entry per committed artwork/palette edit are part of the delivery.

Acceptance: draw several shapes with common colors; reuse one palette across drawing defaults/fill/stroke/gradient stops; reopen a project and recover its colors, names, and pins; deduplicate colors discovered from both artwork and committed choices; keep project palettes independent; retain collected colors when artwork is deleted and restore palette changes on undo; sample the same reference pixel at different tracing opacities and zoom levels; verify cancellation and undo/redo. Run focused paint, creation, reference, persistence, and adjacent animation tests plus browser interaction checks for each implementation slice.

## Timeline and motion refinement

Shared mechanics: track evaluation, timeline selection, retiming, and projected animation previews. Extend the current timeline services and compiled evaluation pipeline.

First delivery:

- Onion skins and motion trails with time ticks.
- Stretch, compress, reverse, and offset selected keyframe blocks.
- Ping-pong preview and editor playback-speed controls.
- Inspect position/value/speed continuity at a loop seam.

Next delivery:

- Optional frame-based timing, frame stepping, and frame-rate controls.
- Value graph alongside the existing speed graph.
- Editable markers and named animation clips.
- Trim-path start, end, and offset controls.
- Assisted path morphing with explicit contour/point correspondence.

Acceptance: retiming preserves relative spacing and easing semantics; preview controls do not leak into base artwork or exports; named clips and new animation properties use versioned migrations and editor/runtime parity fixtures where required.

## Animation presets and procedural motion

Shared mechanics: parameterized motion, reusable animation data, deterministic evaluation, and baking. Start with recipes that generate existing keyframes; introduce a shared evaluator when continuous behaviors need one.

First delivery:

- Save/apply pop, bounce, fade, slide, draw-on, overshoot, and custom presets.
- Stagger by layer order, distance, grid position, or seeded ordering.
- Spring/settling and squash/stretch controls.
- Preview controls and bake-to-keyframes with the source preserved.

Next delivery:

- Follow, look-at, delayed follow, and transform parenting independent of layer grouping.
- Seeded wiggle, controlled motion variation, motion echoes, and seamless orbit/wave loops.
- Audio waveform, beat markers, and amplitude-driven controls.

Acceptance: select objects, choose a preset, adjust a few useful controls, preview, then apply. Keep results reversible; record seeds when baking; require deterministic seeks and equivalent exported playback.

## Reusable styles and assets

Shared mechanics: named resources, references, instances, and explicit overrides. Extend the existing paint and gradient preset owners rather than duplicating resource logic.

- Linked swatches, named styles, and full appearance pickup extend the earlier color-tools delivery. Basic project swatches and the color eyedropper shipped there.
- Linear, radial, and path repeaters.
- Reusable symbols with instance overrides and component variants.
- A personal library of shapes, components, palettes, and animation presets.
- Group isolation, layer search/filtering, solo layers, and named selection sets.
- Multiple artboards after selection, reusable resources, and document migration support are ready.

Acceptance: distinguish linked instances from independent copies, make shared edits predictable, and preserve usable resources through project backup/restore.

## Appearance and typography

Shared mechanics: paint, stroke, text layout, resource definitions, and matching authoring/export renderers.

First delivery:

- Embedded reference images and cropping.
- Arrowheads and path markers.
- Text spacing, styled spans, text-on-path, font handling, and text-to-outlines.
- A small editable effects set: shadow, blur, and glow.

Next delivery:

- Pattern fills, variable-width strokes, alpha/luminance masks, and blend modes.
- Vector effects and paint-order controls.
- Native nested SVG/viewBox and reusable defs/symbol/use semantics.
- Expand editable import coverage from the real-world corpus while retaining sanitized preservation as a fallback.

Acceptance: add migration and import/save/reload/export/visual fixtures for each new persisted SVG family. Report preservation as partial import, not native editability.

## Project safety and editor usability

Shared mechanics: project lifecycle, persistence, history, focus, and command dispatch. Deliver these alongside the creative feature sets.

First delivery:

- **Shipped:** import exported Project JSON through existing migrations as a new copy.
- **Shipped:** session Undo for gallery deletion; a persistent trash area remains a possible follow-up.
- Duplicate projects and expose save/recovery status clearly.
- Keyboard-accessible tools, tabs, and menus.
- Audit Escape, pointer loss, blur, release outside the workspace, and no-op interactions.

Next delivery:

- Named checkpoints and whole-library backup/restore.
- Gallery search, sorting, and folders.
- Command palette, shortcut reference/customization, and workspace presets.
- Offline installation and a touch/pen interaction pass.
- Recovery tests for storage exhaustion, interrupted saves, multiple tabs, and reopening after failure.
- Performance diagnostics for expensive artwork and playback.
- Keep feature/compatibility/deployment documentation accurate and remove development console noise.

Acceptance: retain old project readability, never overwrite unsupported future envelopes, commit mutations once through the established boundary, and preserve clear storage-failure feedback.

## Preview and publishing

Shared mechanics: export artifacts, compatibility diagnostics, and editor/runtime parity.

First delivery:

- Export selected objects and PNG stills.
- Preview the actual exported result and compare it with editor playback.
- Explain supported embedding contexts and fallbacks for each format.
- Author accessibility titles/descriptions and reduced-motion alternatives.

Next delivery:

- Image sequences, video, animated images, and sprite sheets.
- Batch sizes, themes, artboards, and clips.
- SVG optimization with precision and appearance previews.
- Practical vanilla JavaScript, React, Vue, and Angular integration examples.
- Font Awesome project/icon export with stroke-to-shape validation, naming, sizing, variants, and metadata.

Acceptance: export contains no editor overlays; cancellation and diagnostics are actionable; static SVG remains script-free; animated delivery retains deterministic compilation and playback parity.

## Deferred expansions

These remain candidates after the core creation workflow is established:

- Typed expressions and a node editor. Use one versioned AST/DAG for both the text DSL and any later visual editor; include typed variables, time/property references, math, conditions, registered safe functions, cycle diagnostics, and deterministic topological evaluation.
- Full physics and rigging. Use fixed-timestep simulation with baking, then consider bones, weighted path-point deformation, FK/IK, gravity, pendulums, and rig controls. Expressions, physics, constraints, and keys must share one property-evaluation pipeline.
- Use fixed seeds by default; an explicit randomize-on-load option may vary runtime playback, and baking must record the effective seed.
- Interactive states, transition blending, hover/click/focus/scroll triggers, runtime variables, responsive layouts, and data-driven artwork. Serialized runtime variables already exist but do not yet drive expressions or state transitions.
- Optional device sync, review links, and collaboration.

## Completion standard

Each implementation slice has one state owner, reuses existing behavior, preserves layout and event boundaries, and includes relevant interaction or characterization tests. Persistent changes finish through `DocumentMutationService`; structural operations use `LayerOperationsService`/`LayerCommandService`. Serialized changes require sequential migration fixtures before new behavior lands.

Run focused tests and adjacent interaction checks during feature work, plus `npm run build` and `git diff --check`. Reserve `npm test -- --watch=false` for the final overhaul/release pass. Check changed interactions in the browser. Update the current slice status and shipped feature inventory only after verification.
