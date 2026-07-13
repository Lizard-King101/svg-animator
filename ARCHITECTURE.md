# Editor Architecture

## Ownership rules

| Area | Owner | Responsibilities |
|---|---|---|
| Persisted model | `editor/objects` | Document/element state, stable IDs, save/restore, geometry, animation evaluation |
| Session | `EditorService`, `EditorUiStateService` | Open documents, active document, primary selection, tools, viewport conversion, context menus, and ephemeral shell/dialog state |
| Mutation | `DocumentMutationService` | Compare base state, classify mutation domains, create one shared history entry, and schedule persistence/thumbnail work |
| Construction | `ElementFactory` | Element/group construction and deep cloning while model constructors still require `EditorService` |
| Layer structure | `LayerOperationsService` | Group/combine/clip/duplicate/delete/order/visibility/lock/motion-path structural operations |
| Layer commands | `LayerCommandService` | Multi-selection, rename/collapse state, mutation-aware layer commands, context actions, and reorder gestures shared with global shortcuts |
| Property editing | `PropertiesPanelComponent` | Frame, anchor, transform, attribute, paint, and gradient editing with animation-aware writes |
| Animation gestures | `AnimationGestureService` | Capture canvas transform/path/gradient baselines and create animation keys once at gesture completion |
| Rendering | `SVGDisplay`, `SVGEditorOverlayComponent`, `svg-markup.ts` | Interactive artwork, editor-only handles/hit targets, and export-oriented static markup respectively |
| Tools | `_services/tools` | Pointer gesture coordination; transform and path-edit algorithms live in interactions/pure helpers |
| Timeline | `TimelineEditorService`, `TimelineEditingService`, timeline surfaces | Timeline-lifetime interaction state; row/keyframe domain editing; toolbar, dope-sheet, and graph composition |
| Animation evaluation | `AnimationEvaluationPlan`, animation property adapters | Compile/invalidate tracks, evaluate values, and coalesce render-domain outputs |
| Playback rendering | `AnimationPlaybackService`, `ImperativeSvgRenderer` | Retain preview base values, drive playback outside Angular, and batch direct SVG writes |
| Runtime compilation | `compileRuntimeAnimation()` | Produce the deterministic, versioned payload shared by authoring tests and future export/player work |
| Persistence | `ProjectService`, `ProjectRepository` implementations | Async project lifecycle, IndexedDB transactions, legacy migration, save coalescing, and fallback state |
| UI shell | `EditorPage` | Route-driven project loading, provider lifetime, global shortcut precedence, and surface composition |
| UI surfaces | Header, tool palette, dialogs, context menu, guides, panels, and timeline components | Own their templates, local form/gesture state, and feature-specific interaction methods |

## Mutation contract

Persistent changes must finish at `DocumentMutationService`. `commit()` evaluates the animation base state and does nothing if it is unchanged. A real change captures one plain save and reuses it for one history entry and one project upsert. Mutation domains are `artwork`, `animation`, `guides`, `metadata`, and `thumbnail-artwork`. Only artwork-affecting domains invalidate the artwork plan and request an idle thumbnail refresh; animation-only changes retain the current thumbnail. Debounced controls call `schedule()`; structural commands mutate through their domain service and then commit.

History snapshots structurally share unchanged identity, artwork, animation, and guide sections. The per-document limits are 50 entries and 64 MiB of unique serialized section data; the oldest entries are evicted when either limit is exceeded. Gesture previews may mutate live state, but pointer-up commits exactly once, Escape restores the captured values, and no-op gestures commit nothing.

Undo and redo run against base animation state, restore nested selection by stable element/point/line IDs, reset the comparison baseline, and persist the restored document.

Viewport position, zoom, current time, tool choice, expanded rows, dialogs, and context menus are session/UI state and do not belong in document history.

## Model compatibility

This cleanup intentionally retains the current constructors and serialized schema. Model constructors still accept `EditorService`; new construction must go through `ElementFactory` so a later schema-focused pass can remove that dependency without another UI-wide rewrite.

Persisted documents use envelope version 4 and animation schema version 2. Sequential migrators accept historic raw project arrays and document envelope versions 1–3; v1 animation data is upgraded without introducing temporal handles, so existing preset easing remains visually and semantically unchanged. Unsupported future versions are read-only to older clients and are never overwritten. Changes to `SVGSave`, element saves, or animation versions must add a sequential migrator and fixtures first. Existing IDs, shared `Point` identity, compound contours, clipping references, transforms, motion paths, and animation track targets are compatibility constraints.

The primary repository is IndexedDB database `svg-animator`, with separate `projects`, `documents`, `thumbnails`, and `meta` stores. Metadata and document revisions commit in one transaction. Existing localStorage data migrates once and is retained as a read-only backup for one compatibility release. Repository creation falls back to the legacy localStorage format, then to an in-memory session with a persistent save warning.

## Rendering boundary

Interactive authoring may include temporary drawing elements and editor overlays. `buildSVGMarkup()` is the static publishing/thumbnail boundary and must never emit editor handles or hit targets. Import preservation uses sanitized render representations; opaque source must never execute active content.

Animation playback has a separate retained rendering path. `AnimationEvaluationPlan` flattens targets and compiles sorted track data into typed arrays. Forward playback advances active-segment cursors; seeks and reverse movement use binary search. `ImperativeSvgRenderer` caches stable SVG nodes and batches attributes outside Angular so transform, path, paint, gradient, and progress channels produce consolidated DOM writes. Angular remains authoritative for paused authoring, and preview-mutated values are never serialized.

`compileRuntimeAnimation()` is a pure export-ready boundary, not a persisted cache. It interns target/property strings and emits `CompiledAnimationV1` numeric, packed-color, and discrete tracks with diagnostics. The standalone runtime and animated export UI remain future work.

## Verification

Characterization tests cover serialization/migration, shared geometry, compound paths, path strings, authoring and compiled animation evaluation, imperative SVG rendering, repository fallbacks, history sharing, SVG markup/clipping, factory cloning, layer operations, the mutation contract, stroke conversion, path-edit helpers, and timeline/graph editing math. Performance traces follow [ANIMATION_PERFORMANCE.md](ANIMATION_PERFORMANCE.md). Run:

```bash
npm test -- --watch=false
npm run build
```
