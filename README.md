# ![SVG Animator](banner.svg)

A browser-based motion SVG studio for drawing, editing, and keyframe animation.


**Live demo → [svg-animator.multihosts.net](https://svg-animator.multihosts.net)**

---

## What it does now

- Multi-tab SVG documents with pan + zoom
- Pen tool — straight segments, bezier curves, open/closed paths
- Shape tools — rectangle and ellipse with Shift/Alt modifiers
- Select tool — move elements, drag anchors and bezier handles, convert straight ↔ curve, insert/delete points
- Layers panel — nested groups, clipping, visibility, lock, rename, duplicate, drag-reorder, and delete
- Properties panel — per-element attributes (stroke, fill, width/height, caps/joins)
- Project gallery — auto-saves to `localStorage`, thumbnail previews, project name + dimensions picker
- SVG import — safe native conversion with full path-command, clipping, and editable gradient support plus opaque preservation
- Timeline — property keyframes, easing, playback, selection, clipboard, and motion paths
- Export — clean static `.svg` file download
- Undo / redo — per-document history (50 steps)
- Hosted on Cloudflare Pages, routed with SPA fallback

See [`FEATURES.md`](FEATURES.md) for shipped behavior, [`ARCHITECTURE.md`](ARCHITECTURE.md) for ownership rules, and [`ROADMAP.md`](ROADMAP.md) for what comes next.

---

## Product roadmap

Work is ordered around three milestones: SVG import/publishing, deeper native SVG drawing/editing, then expressions/physics/rigging. See [`ROADMAP.md`](ROADMAP.md) and the standards-oriented [`SVG_COMPATIBILITY.md`](SVG_COMPATIBILITY.md).

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
