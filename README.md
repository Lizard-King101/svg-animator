# ![SVG Animator](banner.svg)

A browser-based vector drawing tool with an Illustrator-style workflow. Draw paths, shapes, and layers — then (eventually) animate them on a timeline.


**Live demo → [svg-animator.multihosts.net](https://svg-animator.multihosts.net)**

---

## What it does now

- Multi-tab SVG documents with pan + zoom
- Pen tool — straight segments, bezier curves, open/closed paths
- Shape tools — rectangle and ellipse with Shift/Alt modifiers
- Select tool — move elements, drag anchors and bezier handles, convert straight ↔ curve, insert/delete points
- Layers panel — visibility, lock, rename, duplicate, drag-reorder, delete
- Properties panel — per-element attributes (stroke, fill, width/height, caps/joins)
- Project gallery — auto-saves to `localStorage`, thumbnail previews, project name + dimensions picker
- Export — clean `.svg` file download
- Undo / redo — per-document history (50 steps)
- Hosted on Cloudflare Pages, routed with SPA fallback

See [`FEATURES.md`](FEATURES.md) for full technical detail, object structures, and what's next.

---

## Roadmap toward animation

The drawing layer is being built with animation in mind. The planned workflow:

1. **Transforms** — element-level rotation, scale, skew (prerequisite for meaningful keyframing)
2. **Keyframes** — each element can have keyed properties (position, opacity, stroke, fill…) at timestamps
3. **Timeline panel** — scrubable playhead, per-element track rows, easing curves
4. **Playback** — SVG SMIL or generated CSS animation for preview and export
5. **Export formats** — animated SVG, CSS animation bundle, or frame-by-frame PNG sequence

---

## Dev setup

```bash
npm install
npm start           # dev server → http://localhost:4200
npm run build       # production build → dist/svg-animator/browser
```

Deploy to Cloudflare Pages:

```bash
npm run build
npx wrangler deploy
```

---

## Stack

| | |
|---|---|
| Framework | Angular 21, standalone components, lazy routes |
| Build | `@angular-devkit/build-angular:application` (esbuild) |
| Icons | FontAwesome 7 via `@fortawesome/angular-fontawesome` |
| Hosting | Cloudflare Pages |
| Persistence | `localStorage` (project save/load) |
