# Features & Technical Reference

Developer-facing documentation for the SVG Animator codebase. Covers implementation status, object model, tool logic, and component responsibilities.

---

## Implementation status

### Done

| Feature | Notes |
|---|---|
| Multi-tab SVG documents | Open / close / switch tabs; each tab owns its history |
| Pan canvas | Middle-mouse drag |
| Zoom canvas | Scroll wheel, CSS `scale` on SVG host |
| Pen tool — straight segments | Click to place, Escape to cancel |
| Pen tool — bezier curves | Click-drag to create, Alt to break smooth continuation |
| Path close | Click near first anchor |
| Path rendering | Mixed straight + bezier segments, `Path.raw` generates `d` string |
| Path anchor / handle editing | SelectTool drag with mirrored handles |
| Alt-drag anchor → convert to curve | Initialises both control points on affected segments |
| Insert / delete / convert path points | `I` insert, `C` convert, `Del` delete anchor |
| Rectangle tool | Shift = square, Alt = from center |
| Ellipse tool | Shift = circle, Alt = from center |
| Shape rendering | `<rect>` and `<ellipse>` via SVGDisplay |
| Properties panel | Color, range, select inputs driven by element attribute metadata |
| Custom context menu | Per-tool and per-layer menus |
| Layers panel | Visibility, lock, rename, duplicate, drag-reorder, delete, context menu |
| Undo / redo | Per-SVG `_past` / `_future` stacks (50 steps), Ctrl+Z / Ctrl+Y |
| Export SVG | Clean `.svg` download from live element state |
| Project gallery | `localStorage` persistence, thumbnail previews, new-project dialog with dimension presets |
| Project auto-save | Saves on every snapshot (mouseup, click, rename, duplicate, delete, reorder) |
| Cloudflare Pages hosting | `wrangler.toml` with `not_found_handling = "single-page-application"` |
| Text element | `TextElement` class; `@chenglou/pretext` for natural bounding box sizing; font family/size/weight/color attributes; multi-line `<tspan>` rendering; select + drag to move |

### Not yet implemented

| Feature | Notes |
|---|---|
| **Element rotation & transforms** | SVG `transform` attribute on elements; rotate handle in SelectTool; scale/skew to follow |
| **Custom web fonts** | Load external font URLs into the editor (e.g. Google Fonts / self-hosted); make them available in the font-family picker; embed `@font-face` in exported SVG |
| **Transparency / alpha on Color** | Extend `Color` object with alpha channel; update color picker input with opacity slider; serialize as `rgba` / `#rrggbbaa`; wire `fill-opacity` / `stroke-opacity` per-element |
| Multi-select + selection box | Marquee drag; group transform of selected elements |
| Group / ungroup workflow | `Group` object exists but is not rendered or user-accessible |
| Group rendering in SVGDisplay | `<g>` element with nested children |
| Layer tree (nested groups) | Indented layer rows, expand/collapse |
| Snap / grid / guides | Configurable pixel snap, grid overlay, guide lines |
| Dashed strokes | `stroke-dasharray` / `stroke-dashoffset` attribute inputs |
| Corner radius on rectangles | `rx` / `ry` attribute |
| Copy / paste across tabs | Clipboard serialisation of element saves |
| Dedicated node-edit tool | Separate tool from SelectTool; cleaner anchor-only mode |
| **Animation — keyframes** | Per-element keyed property values at timestamps |
| **Animation — timeline panel** | Scrubable playhead, track rows, easing curves |
| **Animation — playback** | SVG SMIL or CSS animation preview |
| **Animation — export** | Animated SVG / CSS bundle / PNG sequence |

---

## Architecture

### Bootstrap

```
main.ts → bootstrapApplication(AppComponent, appConfig)
```

`app.config.ts` holds app-level providers:
- `provideRouter(routes)`
- FontAwesome icon registration via `ENVIRONMENT_INITIALIZER`

### Routing

Two lazy standalone routes:

| Path | Component |
|---|---|
| `/home` | `HomePage` — project gallery |
| `/editor` | `EditorPage` — drawing canvas |

`/editor?id=<projectId>` loads an existing project from `localStorage`.  
`/editor` (no params) auto-opens the new-project dialog.

### EditorService scope

`EditorService` is provided on `EditorPage`, not root. Each `/editor` navigation creates a fresh session. Do not move it to root unless cross-navigation persistence is explicitly desired.

### Change detection

`EditorPage.ngAfterViewInit()` attaches raw DOM listeners to the viewport. Those handlers are wrapped in `ngZone.run()` to keep Angular change detection reliable with Angular 21 + esbuild.

---

## Object model

### `SVG`

Top-level document. Lives in `editor/objects/svg.object.ts`.

```
SVG
├── id, name, width, height
├── pos: Point          — viewport pan offset
├── zoom: number        — CSS scale factor
├── elements[]          — permanent elements (draw order)
├── tempElements[]      — in-progress preview elements
├── _past: SVGSave[]    — undo stack (max 50)
└── _future: SVGSave[]  — redo stack
```

Key methods:
- `save() → SVGSave` — full JSON-serialisable snapshot
- `snapshot()` — push to `_past`, deduplicated by JSON diff
- `undo()` / `redo()` — move between stacks, call `restore()`
- `SVG.fromSave(save, editor, vpW, vpH)` — recreate from snapshot, preserves shared Point refs

### `Path`

Path is a list of `Line` segments. Lives in `editor/objects/elements/path.object.ts`.

```
Path
├── id, name, visible, locked
├── lines: Line[]
├── closed: boolean
├── settings: { stroke_width, fill, stroke, line_cap, line_join }
├── attributes: ElementAttribute[]   — drives Properties panel
└── raw: string (getter)             — generates SVG `d` attribute
```

`raw` generates the `d` string by walking `lines[]`. Bezier segments use `C` with `controlStart ?? start` / `controlEnd ?? end` fallbacks, so partially-initialised bezier segments still produce valid output.

### `Line`

One segment in a path. Lives in `editor/objects/line.object.ts`.

```
Line
├── type: 'line' | 'bezier'
├── points: Point[]       — [start, end]
├── controlStart?: Point  — outgoing handle from start
└── controlEnd?: Point    — incoming handle at end
```

Adjacent segments share endpoint `Point` instances by reference. `Line.fromSave()` accepts an optional `resolvePoint` function so `Path.fromSave()` can deduplicate via a `Map<id, Point>`.

### `Shape`

Primitive rectangle or ellipse. Lives in `editor/objects/elements/shape.object.ts`.

```
Shape
├── id, name, visible, locked
├── type: 'ellipse' | 'rectangle'
├── position: Point
├── settings: { width, height, stroke_width, stroke, fill }
└── attributes: ElementAttribute[]
```

Computed geometry getters: `x`, `y`, `width`, `height`, `radiusX`, `radiusY`, `centerX`, `centerY`.

### `Group`

Container for nested elements. Exists in the data model but not yet rendered or user-accessible. `Group.fromSave()` is not implemented — groups are silently dropped on restore.

### `Color`

Utility that keeps `hex`, `r`, `g`, `b` in sync. Constructed from a hex string.

**Planned:** add `alpha: number` (0–1), update serialisation, add opacity slider to the color input component.

### `Point`

2D point with a stable random `id`.

```typescript
new Point(x, y, id?)
point.add(other)        → new Point
point.addTo(other)      // mutates
point.subtract(other)   → new Point
point.distanceFrom(p)   → number
```

### Save / restore chain

```
Point.toSave() / Point.fromSave()
  ↕ PointSave { id, x, y }

Line.toSave() / Line.fromSave(s, editor, resolvePoint?)
  ↕ LineSave { id, type, points[], controlStart?, controlEnd? }

Path.save() / Path.fromSave()
  ↕ PathSave { type:'path', id, name, visible, locked, closed, settings, lines[] }

Shape.save() / Shape.fromSave()
  ↕ ShapeSave { type:'shape', id, name, visible, locked, shapeType, position, settings }

SVG.save() / SVG.fromSave()
  ↕ SVGSave { id, name, width, height, elements: ElementSave[] }

ProjectService.upsert(svgData, thumbnail)
  ↕ ProjectRecord { id, name, thumbnail, createdAt, updatedAt, svgData }
  → localStorage 'svg-animator-projects'
```

---

## Editor state

Key `EditorService` fields:

| Field | Purpose |
|---|---|
| `selectedElement` | Element selected in the layers panel / for Properties |
| `activeElement` | Element being created by the current tool |
| `inspectedElement` | `selectedElement ?? activeElement` — drives Properties panel |
| `selectedPathAnchor` | Currently active anchor in edit mode |
| `selectedPathLine` | Currently active segment in edit mode |
| `contextMenu` | Active custom context menu state |

`selectedElement` and `activeElement` are intentionally separate. Do not collapse them.

---

## Tools

Tools live in `src/app/_services/tools/` and are plain TS classes instantiated by `EditorService`. The `Tools` array in `tools.ts` defines toolbar order.

### Base `Tool`

All tools share: `selected`, `icon`, `children`, `showChildren`, event handlers (`down/up/drag/click/contextMenu`), `keyPressed/keyReleased`, `reset/deselect`.

### `SelectTool`

- Click to select visible, unlocked elements
- Drag to move selected element
- Drag path anchors and bezier handles
- Handles mirror by default; hold Alt to break symmetry
- Alt-drag an anchor to convert it into a curve point — initialises both `controlStart` and `controlEnd` on the affected segments
- Keyboard: `C` convert segment, `I` insert point, `Del` delete anchor, `[`/`]` move layer order

### `PenTool`

- Click → straight segment
- Click-drag → bezier segment with live handle preview
- Outgoing handle is seeded from the previous curve's mirror; Alt breaks that
- Click near first anchor → close path
- Escape → cancel in-progress path

### `ShapeTool` (parent) + `Rectangle` / `Ellipse`

- Right-click or first-click on parent opens child picker
- Down → create, drag → preview, up → finalise
- Shift = constrain (square/circle), Alt = draw from center, both together = centered square/circle

---

## Components

### `EditorPage`

Owns viewport event wiring, tab UI, toolbar, Properties panel, Layers panel, and context menu host. Also owns all layer operations: select, rename, duplicate, move, delete, drag-reorder. `snapshotAndSave()` is called after every mutation — it calls `HistoryService.snapshot()` then `ProjectService.upsert()`.

### `SVGDisplay`

Applied as attribute `[display]` to the `<svg>` element. Renders:
- `Path` elements (path `d` from `element.raw`)
- `Shape` elements (`<rect>` / `<ellipse>`)
- `TextElement` elements (`<text>` + `<tspan>` per line, `dominant-baseline="hanging"`, dashed selection rect)
- Temp preview elements during creation
- Edit overlays: segment hit areas, anchors, bezier guide lines, control points

### Attribute components

Generic `ControlValueAccessor` components in `_components/attributes/`:

| Component | Input type |
|---|---|
| `color` | Color picker |
| `range` | Slider with numeric value |
| `attr-select` | Dropdown |
| `attr-bool` | Toggle switch |
| `attr-text` | Multiline textarea |

Driven by each element's `attributes: ElementAttribute[]` metadata array.

### `ProjectService`

Root-provided. Stores `ProjectRecord[]` under `'svg-animator-projects'` in `localStorage`. Methods: `list()`, `get(id)`, `upsert(svgData, thumbnail)`, `remove(id)`.

### `HistoryService`

Provided on `EditorPage`. Thin facade over `SVG._past` / `_future`. After undo/redo it attempts to re-select the previously selected element by ID.

---

## Element attribute metadata

The `PathAttributes` / `ShapeAttributes` `as const satisfies readonly ElementAttribute[]` arrays define what appears in the Properties panel. Each entry maps:

```typescript
{
  label: string        // UI label
  name: string         // SVG attribute name (informational)
  input: 'color' | 'range' | 'select'
  output: string       // key into element.settings
  min?: number         // range only
  max?: number         // range only
  options?: { label, value }[]  // select only
}
```

`SettingsFromAttributes<typeof XxxAttributes>` derives the strongly-typed settings object from the const array.

---

## Styling tokens

Dark industrial theme defined in `src/styles.scss`:

| Token | Value | Usage |
|---|---|---|
| `--bg-base` | `#0d0d11` | App background |
| `--bg-surface` | `#14141a` | Panels |
| `--bg-elevated` | `#1b1b23` | Cards / popups / inputs |
| `--bg-canvas` | `#1a1a22` | Viewport background |
| `--border` | `#252532` | Dividers |
| `--border-bright` | `#363648` | Hover / active borders |
| `--text-primary` | `#dddde8` | Main text |
| `--text-secondary` | `#7878a0` | Labels |
| `--text-muted` | `#44445a` | Placeholders / subdued UI |
| `--accent` | `#2dd4bf` | Active states / highlights |
| `--danger` | `#f45c7a` | Destructive actions |

Typography: `Plus Jakarta Sans` for UI, `JetBrains Mono` for technical values and shortcut labels.

Context menu and layer row styles live in `src/styles.scss` (global) to keep per-component style budgets low.

---

## Dependencies

| Package | Version | Notes |
|---|---|---|
| `@angular/*` | ^21.2.8 | Standalone-first |
| `@fortawesome/angular-fontawesome` | ^4.0.0 | FA7 standalone integration |
| `@fortawesome/fontawesome-svg-core` | ^7.2.0 | Icons registered in `app.config.ts` |
| `bootstrap` | ^5.3.0 | CSS imported via `@use` in `styles.scss` |
| `zone.js` | ~0.16.0 | App is not zoneless |
| `typescript` | ~5.9.0 | Required for Angular 21 |
| `wrangler` | ^4.x | Cloudflare Pages deploy |
