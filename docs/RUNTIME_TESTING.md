# Runtime parity testing

Runtime parity tests answer a specific question: given the same editable project and timeline time, do editor preview and the exported player produce the same visually meaningful SVG state?

## Capture a user project

1. Open the project in the editor, stop playback, and allow its latest changes to save.
2. Return to the Projects view, open that project's three-dot menu, and choose **Export project**.
3. Keep the resulting `*.svg-animator.json` alongside the Web Bundle ZIP from the same editor build.

Project JSON is the editable document envelope, currently document v5 with animation v2. It is available even when animation tracks are orphaned, invalid, or unsupported, because those broken references are often necessary to reproduce a bug. Export runs from animation base state, so temporary preview mutations are not captured. Runtime ZIPs contain compiled playback data only and cannot substitute for Project JSON when investigating editor/export differences. Project JSON import is not yet exposed in the gallery, so treat this as a source capture for tests rather than a complete UI backup/restore workflow.

The export is deterministic: unchanged project state produces identical JSON bytes. It contains no compiled runtime cache or timestamp.

## Promote a reproduction to an immutable fixture

Choose a short behavior-oriented slug, then copy the captured file without editing its representation:

```text
fixtures/<slug>/document-v5.json
```

Add `src/app/editor/animation/<slug>.spec.ts`:

```ts
import envelope from "../../../../fixtures/<slug>/document-v5.json";
import { SVG, SVGSave } from "../objects/svg.object";
import {
    expectRuntimeDomParity,
    runtimeParitySampleTimes,
} from "./runtime-dom-parity.spec-support";

describe("<slug> immutable runtime fixture", () => {
    const source = SVG.fromSave(envelope.data as SVGSave, { ID: "fixture-id" } as never).save();

    it("matches editor preview and runtime output", () => {
        expectRuntimeDomParity(source, runtimeParitySampleTimes(source));
    });
});
```

`runtimeParitySampleTimes()` includes time zero, duration, every playable key time, and the midpoint of every key segment, including segments whose keys lie before or after the playable interval. Add explicit times when the bug occurs at a known temporal overshoot, marker crossing, or narrow discrete transition.

Keep a focused assertion for the original symptom when possible—for example, an expected transform matrix, path `d`, gradient stop opacity, or dash reveal offset. The general harness compares DOM structure, transforms, geometry/path data, paints, gradients, opacity, visibility, and draw-progress state. It canonicalizes SVG defaults and allows only the runtime format's documented numeric and 8-bit color quantization.

`runtime-animation-example-v1` is the real-world reference for geometry-position tracks combined with pinned transform origins, temporal overshoot, and animated scale/translation. Its regression test checks the original star positions explicitly and then samples the complete project timeline.

Do not replace or silently rewrite an accepted fixture. Contract changes freeze the old representation first and add migration/adapter coverage according to [COMPATIBILITY.md](COMPATIBILITY.md).

## Run the checks

Run one new fixture while iterating:

```bash
npm test -- --watch=false --include='src/app/editor/animation/<slug>.spec.ts'
```

Then run the generated webpage and complete release checks:

```bash
npm run build:runtime       # builds dist and copies browser assets to public/assets/runtime
npm run runtime:web-smoke   # mounts, plays, pauses, and seeks minified + unminified players in Chrome
npm run verify              # fixtures, all tests, smoke page, editor build, API report, and size budget
```

The DOM-parity harness runs in real Chrome through Karma. The webpage smoke test serves canonical exports over loopback HTTP; it avoids `file://` restrictions, checks both browser artifacts, and mounts the Embedded Animation SVG through `<object>` with the minified shared runtime. Generated Web Bundles append a content revision to the runtime script URL, but browser developer caches can still obscure manual tests of old exports. Test a newly generated artifact and use a hard reload when replacing files in place.

## Diagnosing a failure

The parity assertion reports the timeline time, SVG node, attribute, editor value, and runtime value. Classify the difference before changing tolerances:

- A semantic difference—wrong matrix, geometry, paint alpha, path, visibility, or mask state—belongs in the shared evaluator/rendering implementation.
- An equivalent SVG representation—such as omitted opacity `1`, inherited text position, or identity gradient transform—belongs in parity canonicalization.
- A compiler difference should first be reduced to authoring-track versus compiled-track evaluation.
- A browser-only mount or loading failure belongs in `scripts/test-runtime-web-export.ts`.

If only a Runtime Assets or Web Bundle ZIP is available, preserve it for player-side diagnosis but request Project JSON as well; compiled bundles do not retain enough authoring information to calculate the editor side independently.
