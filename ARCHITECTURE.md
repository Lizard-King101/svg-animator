# Editor Architecture

## Ownership rules

| Area | Owner | Responsibilities |
|---|---|---|
| Persisted model | `editor/objects` | Document/element state, stable IDs, save/restore, geometry, animation evaluation |
| Session | `EditorService` | Open documents, active document, selection, tools, viewport conversion, keyboard and context-menu state |
| Mutation | `DocumentMutationService` | Compare base state, create one history snapshot, autosave JSON, and regenerate the thumbnail |
| Construction | `ElementFactory` | Element/group construction and deep cloning while model constructors still require `EditorService` |
| Layer structure | `LayerOperationsService` | Group/combine/clip/duplicate/delete/order/visibility/lock/motion-path structural operations |
| Rendering | `SVGDisplay`, `SVGEditorOverlayComponent`, `svg-markup.ts` | Interactive artwork, editor-only handles/hit targets, and export-oriented static markup respectively |
| Tools | `_services/tools` | Pointer gesture coordination; transform and path-edit algorithms live in interactions/pure helpers |
| Timeline | `TimelineEditingService`, timeline utilities | Row projection, keyframe selection/clipboard/editing, and time/scale math |
| UI shell | `EditorPage` | Project/tab lifecycle, mode switching, dialogs, and composing workspace/panels/timeline |
| UI surfaces | `CanvasWorkspaceComponent`, `PropertiesPanelComponent`, `LayersPanelComponent` | Viewport lifecycle/gestures and named panel composition boundaries |

## Mutation contract

Persistent changes must finish at `DocumentMutationService`. `commit()` evaluates the animation base state and does nothing if it is unchanged. A real change produces exactly one history snapshot and one project upsert/thumbnail regeneration. Debounced controls call `schedule()`; structural commands mutate through their domain service and then commit.

Undo and redo run against base animation state, restore nested selection by stable element/point/line IDs, reset the comparison baseline, and persist the restored document.

Viewport position, zoom, current time, tool choice, expanded rows, dialogs, and context menus are session/UI state and do not belong in document history.

## Model compatibility

This cleanup intentionally retains the current constructors and serialized schema. Model constructors still accept `EditorService`; new construction must go through `ElementFactory` so a later schema-focused pass can remove that dependency without another UI-wide rewrite.

Persisted projects use versioned project-database and document envelopes. Historic raw project arrays migrate to version 1 on read without changing their `SVGSave` payloads. Unsupported future versions are read-only to older clients and are never overwritten. Changes to `SVGSave`, element saves, or animation versions must add a sequential migrator and fixtures first. Existing IDs, shared `Point` identity, compound contours, clipping references, transforms, motion paths, and animation track targets are compatibility constraints.

## Rendering boundary

Interactive rendering may include temporary drawing elements and editor overlays. `buildSVGMarkup()` is the publishing/static-thumbnail boundary and must never emit editor handles or hit targets. Import preservation will use sanitized render representations; opaque source must never execute active content.

## Verification

Characterization tests cover serialization, shared geometry, compound paths, path strings, animation evaluation, SVG markup/clipping, history, factory cloning, layer operations, the mutation contract, stroke conversion, path-edit helpers, and timeline editing/math. Run:

```bash
npm test -- --watch=false
npm run build
```
