# ![SVG Animator](banner.svg)

A browser-based motion SVG studio for drawing, editing, and keyframe animation.

> **Working motto:** Clean boundaries. One source of truth. Reusable behavior. Polished interactions.


**Live demo → [svg-animator.multihosts.net](https://svg-animator.multihosts.net)**

---

## What it does now

- Multi-tab SVG documents with pan + zoom
- Pen tool — straight segments, bezier curves, open/closed paths
- Rig-friendly outlines — multiple visible sections on one weighted path, curve-local trimming, independent end tapers, and protected Break/Open/Close commands
- Shape tools — rectangle and ellipse with Shift/Alt modifiers
- Select tool — shared multi-selection with Layers, marquee, move/scale/rotate selections, keyboard nudging, anchor and bezier editing, straight ↔ curve conversion, and point insertion/deletion
- Layers panel — nested groups, clipping, visibility, lock, rename, duplicate, drag-reorder, and delete
- Properties panel — per-element attributes (stroke, fill, width/height, caps/joins), app-session object copy/paste, alignment to selection/canvas/last selected, and equal-gap spacing
- Project gallery — asynchronous IndexedDB autosave, thumbnail previews, editable Project JSON import, session Undo for deletion, project name + dimensions picker, and resilient localStorage/in-memory fallbacks
- SVG import — safe native conversion with full path-command, clipping, and editable gradient support plus opaque preservation
- Animation workspace — virtualized timeline, speed graph, per-axis keyframe retiming, velocity/influence handles, easing presets, playback, selection, clipboard, and motion paths
- Character rigging and animation — bone layers, FK and persistent two-bone IK, keyed bone/target poses, reusable rig actions, unified bone assignment, automatic and locked multi-point weights, shared seams, independent Bézier handles, and artwork-first or bone-first weight painting
- Publishing — editable Project JSON from project-card actions plus a focused editor export flow for clean Static SVG, Embedded Animation SVG, self-contained Animated SVG, Runtime Assets ZIP, and ready-to-run Web Bundle ZIP
- Undo / redo — per-document, section-shared history (50 entries with a 64 MiB unique-section budget)
- Hosted on Cloudflare Workers Static Assets, routed with SPA fallback

See [`FEATURES.md`](FEATURES.md) for shipped behavior, [`ANIMATION_GUIDE.md`](ANIMATION_GUIDE.md) for animation controls, [`docs/RUNTIME.md`](docs/RUNTIME.md) for player/export integration, [`docs/RUNTIME_TESTING.md`](docs/RUNTIME_TESTING.md) for capturing user projects and adding parity fixtures, [`ARCHITECTURE.md`](ARCHITECTURE.md) for ownership rules, and [`ROADMAP.md`](ROADMAP.md) for what comes next.

---

## Product roadmap

The overhaul is grouped around selection/snapping, path editing, motion refinement, animation tools, reusable assets, appearance, project safety, and publishing. Start with handle usability and comfortable scene creation, then precision drawing and animation. See [`ROADMAP.md`](ROADMAP.md) for scope and delivery order and [`SVG_COMPATIBILITY.md`](SVG_COMPATIBILITY.md) for standards coverage.

---

## Dev setup

```bash
npm ci --legacy-peer-deps
npm start           # dev server → http://localhost:4200
npm run build       # production build → dist/svg-animator/browser
npm run verify      # runtime, fixtures, tests, app, API report, and size budget
```

Deploy to the existing Cloudflare Worker `svg-animator` at
[svg-animator.multihosts.net](https://svg-animator.multihosts.net):

```bash
npx wrangler login   # first use, or when your saved login expires
npx wrangler whoami  # confirm the account that owns multihosts.net
npm run deploy      # build the runtime + editor, then publish
```

`wrangler.toml` owns the Worker name, custom domain, build output directory, and
SPA fallback. `npm run deploy:check` builds and checks deployment packaging
without publishing. Wrangler is pinned as a local development dependency.

The GitHub `Verify` workflow only runs checks; it does not deploy. Any separate
[Cloudflare Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
Git connection is managed in the Cloudflare dashboard.

---

## Stack

| | |
|---|---|
| Framework | Angular 21, standalone components, lazy routes |
| Build | `@angular-devkit/build-angular:application` (esbuild) |
| Icons | FontAwesome 7 via `@fortawesome/angular-fontawesome` |
| Hosting | Cloudflare Workers Static Assets |
| Persistence | IndexedDB (`projects`, `documents`, `thumbnails`, `meta`) with localStorage and in-memory fallbacks |
| Animation | Compiled evaluation plans, retained preview rendering, and dependency-free RuntimeBundleV1 playback |
