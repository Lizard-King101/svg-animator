# Renderer overhaul

## Direction

Keep the editable vector document and continuous-time animation as the source of truth. Compile transient drawing data that can feed an SVG fallback or a GPU renderer. Keep editor overlays, selection, snapping and persistent mutations under their current owners. No saved-file migration, frame snapping, geometry simplification or automatic quality reduction.

The dense ten-rig baseline is 36.8 ms p95 application work, while the separate compiled rig kernel benchmark is 0.579 ms p95. Those are different measurement scopes. They motivate investigating geometry projection and rendering before moving IK to GPU compute.

## Slice 1: numeric outlines and renderer lab

Implemented:

- The shared outline kernel has one expansion algorithm with SVG-string and numeric-polygon outputs. Sampling, tapers, joins, caps, dash ranges, winding and 1e-4 output precision are shared. Existing editor/export callers still receive SVG strings.
- `PolygonDraw` is a transient solid-paint drawing boundary with stable IDs and geometry revisions. `PolygonFanBuffer` packs reusable typed storage. Revisions must change whenever coordinates or topology change; paint and viewport changes do not require geometry uploads.
- `WebGpuPolygonRenderer` retains vertex buffers by ID/revision, grows capacity when needed, releases removed objects, resizes multisample/stencil attachments and owns device/context cleanup. Signed triangle fans accumulate nonzero winding; a separate cover draws a compound shape once, including alpha, and clears its stencil. Four-sample antialiasing is explicit. Ordinary drawing never reads pixels back.
- A local comparison lab extracts **only the solid derived outlines** from the existing 1/3/10-rig fixture. Its animation and deformation are real shared editor evaluation; nested clipping, ordinary strokes, fills and attachments are not drawn. It is not a full-editor benchmark. Both panes use the same displayed resolution. The SVG backend remains visible on GPU initialization or device failure.
- Browser verification explicitly copies the submitted GPU texture before presentation; reading the canvas after waiting for GPU work can accidentally capture an already-cleared swap texture. Readback exists only for diagnostics.

Run:

```sh
npm run renderer:check
npm run renderer:lab
# Default browser capability/fallback check; a GPU skip is reported, not passed as GPU validation.
npm run renderer:lab -- --smoke
# Reproducible software-GPU correctness check; require an actual GPU API result.
npm run renderer:lab -- --smoke --software-gpu --require-gpu --verify-only
# Opt-in experimental headless Linux/Vulkan configuration. Inspect adapter identity.
npm run renderer:lab -- --smoke --hardware-gpu --require-gpu
```

The server binds only to localhost, builds in a temporary directory and uses synthetic data. Smoke runs use a temporary Chrome profile and clean up processes/files. `--software-gpu` selects Chromium's SwiftShader Vulkan stack; it must not establish hardware performance claims. The hardware flag requests Vulkan but does not prove a hardware adapter was selected. These launch settings affect only the isolated test browser, not the user's browser profile.

The lab measures backends separately after warmup, with elapsed-time samples, idle refresh calibration, bounded sample counts and p50/p95/p99 stage timings. CPU submission time excludes GPU execution. The interactive comparison updates both panes and is intentionally not used as the single-backend timing result.

### Scope gates before editor integration

This backend currently supports solid, nonzero-filled polygons, including concavity, holes and overlaps. It does **not** yet implement the complete SVG feature set. In particular:

- Gradients, nested clips/masks, group opacity/isolation, image/reference sampling, text and blend semantics need an explicit scene contract and parity tests.
- Inside/outside outline alignment still requires source-fill clipping. The lab uses centered outlines only.
- An eight-bit wrapping stencil cannot represent winding magnitudes of 256 or more. The prototype is not a safe general fallback for arbitrary imported geometry until overflow handling or a different filling strategy is implemented.
- Numeric geometry is converted to float32 on upload. Large-coordinate precision and zoomed edge antialiasing need measured limits and a fallback policy. Interior pixel parity alone does not establish complete raster parity.
- CPU curve sampling and stroke expansion remain in place. There is no GPU compute, worker offload or editor renderer switch in this slice.

### Validation — 2026-10-27

Chrome Headless 149 on Linux, AMD Ryzen 9 6900HX host. The default headless configuration returned no WebGPU adapter and exercised SVG fallback. The explicit SwiftShader Vulkan configuration passed interior-pixel comparisons for concavity, holes, self-intersections, compound alpha, separate overlapping alpha shapes/stencil reset, tapered dashed curves, offscreen geometry, empty frames, retained geometry with paint changes and both square/non-square resize (128, 256 and 690×552 surfaces). Comparisons allow 3/255 premultiplied color/alpha error and exclude one-pixel reference edge neighborhoods. This is software-GPU correctness evidence, not a hardware speedup.

Direct GPU readback passed all 11 cases, but headless SwiftShader page screenshots showed corrupted canvas presentation despite correct texture bytes, including before diagnostic device teardown. Browser presentation therefore remains an unresolved rollout gate; these checks must not be described as end-to-end visual parity. The lab includes `--screenshot` to capture pre/post-verification page images under `/tmp`.

The forced hardware Vulkan attempt failed with a driver `VK_ERROR_OUT_OF_DEVICE_MEMORY` / device-loss error during verification. That initial headless run supports no hardware timing claim; the subsequent user-supplied NVIDIA desktop result is recorded in `ANIMATION_PERFORMANCE.md`. Run the lab in a GPU-capable desktop browser and record the adapter, resolution, workload, refresh interval and missed refreshes before choosing this backend for editing.

Focused validation: 55 outline/renderer browser tests passed. The renderer/lab TypeScript check, production build, runtime golden fixtures, API declaration report, runtime size budget (20,111 / 30,720 gzip bytes), minified/unminified/embedded web smoke tests, and `git diff --check` passed. The API report includes new internal outline declarations; the package entry-point exports and saved document format are unchanged. The full suite is reserved for the final overhaul check.

## Following slices

1. **Compiled scene representation and feature eligibility.** Ordered paint/clip commands, explicit transforms/local coordinate spaces, bounds, dependencies and dirty revisions. Document → compiled scene → backend; avoid a second editable document model. Add full-scene fixtures before connecting a renderer selector.
2. **Complete paint and compositing parity.** Clipping, gradients, source-fill alignment, opacity groups, images/text and antialiasing. Establish winding/coordinate limits and whole-scene fallback behavior. Compare screenshots at multiple zooms and pixel ratios.
3. **Worker rendering and input synchronization.** Move compiled scene evaluation/rendering behind OffscreenCanvas. Bounded latest-request delivery, document/revision IDs, stale-result rejection, exact final-pointer flush, cancellation and one undo entry. Keep main-thread overlays aligned with the presented pose.
4. **Hierarchical transforms and retained scene updates.** Character/scene root movement reuses local geometry; dirty dependencies update only affected bindings/outlines. Preserve world-space constraint semantics. Add viewport culling and resolution-aware static caches only with invalidation coverage.
5. **Targeted GPU compute.** Profile again, then consider outline expansion or weighted deformation with results consumed directly by rendering. Avoid GPU → CPU readback → SVG serialization per frame.
6. **Editor/runtime rollout and scale acceptance.** Opt-in editor backend after eligibility/parity gates, reliable capability/device-loss fallback, overlay/hit-test alignment, actual hardware 1/3/10-rig measurements and full regression/release checks. Preserve SVG export and the public runtime API until a separate runtime-backend decision is made.

References: [WebGPU render pipeline and stencil operations](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/createRenderPipeline), [Chromium headless GPU configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/using-gpu-hardware-in-headless-chrome.md), [Chromium SwiftShader configuration](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/gpu/swiftshader.md).

## Slice 2: CPU geometry and packed emission

Implemented after the user's successful NVIDIA Ampere desktop run. The updated report has `pipeline: packed-outlines-v2`.

- Shared curve sampling uses one default step count and evaluates each cubic once. Ordered taper sampling retains the exact original interpolation arithmetic. Adjacent directions are reused and joins avoid temporary normal/offset arrays. SVG/editor/export consumers benefit from the same kernel changes.
- `visitOutlinePolygons` emits rounded vertices synchronously without metadata that a solid GPU draw does not need. Consumers must pack borrowed vertices during the callback.
- `PolygonFanBuffer` appends those polygons directly into growing reusable storage. `PolygonDraw` accepts either polygon input or explicitly packed triangles; the renderer validates both and uploads without repacking prepared vertices.
- The lab retains contour references, draw objects and buffers per scene. Draw IDs include scene identity to prevent stale buffers when workload replacement resets local revision numbers. Repeated projection of the same evaluated revision reuses its result.
- The pre-change kernel matched 810 characterization cases exactly. Same-loop Node geometry preparation p95 fell from 19.91 to 10.09 ms; see `ANIMATION_PERFORMANCE.md` for measurement scope and validation details. The confirmed desktop result is recorded below and in `ANIMATION_PERFORMANCE.md`: WebGPU application p95 9.5 ms, with zero missed refreshes in the 180-sample run.

### Worker boundary for the next slice

The reusable buffers are **borrowed synchronous data**, not yet transferable frames. Transferring their backing buffer while the producer still owns it would detach live storage. Worker integration needs explicit ownership and a bounded buffer pool, plus document/scene generations and monotonically increasing request IDs. Keep at most one evaluation in flight and one latest queued preview, reject stale generations, and preserve a separately acknowledged final pointer sample before committing. Cancellation must not publish the queued preview.

Prefer compiling a framework-free scene snapshot once per document/setup revision and doing evaluation, geometry preparation and GPU submission together in an OffscreenCanvas worker. Sending expanded geometry back to the main thread every frame would add avoidable transport and synchronization. The current lab fixture imports editor model construction; that must not become the worker/editor architecture by accident. Define the scene/paint/clip contract and typed input updates before transferring ownership. No worker or editor renderer switch is introduced by this slice.

## Slice 3: framework-free outline snapshot and worker lab

The experimental lab now has a third backend (`worker-outlines-v3`). `OutlineSceneSnapshot` is explicitly limited to extracted solid, centered outlines; it is not yet the full paint/clip scene contract listed above. It contains plain rig setup, compiled runtime animation channels and outline source geometry. The lab adapter reuses the existing runtime animation compiler; the worker imports only the shared runtime evaluators, outline kernel, packed buffer helper and GPU renderer. The lab build rejects Angular/editor-model imports in the worker dependency graph.

`OutlineScene` owns its setup copy, resolves channels and bound point destinations once, preflights all rig solves before writing drawable points, and retains packed buffers in the worker. Same-time, backward, loop-boundary and action-window evaluations use the existing runtime interpolation and dependent-IK implementations. The editor and snapshot projections agree within 0.00025 coordinate units (runtime compiler channel normalization can cross the shared 1e-4 geometry rounding boundary); arbitrary timestamps are not snapped.

`LatestFrameQueue` permits one in-flight request and one replaceable queued preview. A final sample is a non-replaceable barrier. Cancellation resolves discarded work without delivering it, and allows a restoration sample behind already sent work. It cannot retract already submitted pixels. Each document/setup replacement terminates the old worker and replaces the transferred canvas, isolating old-generation presentation. Monotonic request IDs and generation checks reject stale acknowledgements. Startup errors, device loss, message failures and a 15-second watchdog leave the main-thread backends available.

The worker owns evaluation, geometry and OffscreenCanvas GPU submission. Only time, surface dimensions and small acknowledgements cross threads per frame. There is no transferable geometry pool because vertex storage never leaves its producer. Pixel buffers are transferred only by explicit diagnostic capture. Final acknowledgement confirms CPU submission, not compositor presentation; editor overlay/hit-test synchronization and undo integration remain rollout gates.

Use **Play worker only** to exercise playback without simultaneously evaluating the main-thread comparison. Scrub previews coalesce; release/keyboard changes and pause flush the exact final timestamp. Pointer cancellation/Escape during a scrub restores its starting timestamp. **Measure separately** reports all three backends, including queue supersession and response latency. Restart the lab server and open its newly printed URL after code changes; it builds once at startup.

Validation: 30 focused renderer/queue/scene and adjacent runtime compiler tests passed. The 1/3/10-rig snapshot tests cover editor agreement, source isolation, backward seeks, loop seams, action boundaries and invalid setup. Queue tests cover bounded coalescing, stale/duplicate responses, final barriers, cancellation/restoration and transport failures. Software-GPU browser verification passed the existing 19 raster cases plus 21 worker/main-thread readback comparisons at alternating sizes across 1/3/10-rig worker replacements, rapid-preview/exact-final delivery, and lab Escape-restoration/keyboard-final handlers. This does not resolve the earlier headless presentation issue or establish full-scene raster parity. Hardware worker timings were subsequently supplied and are recorded in the slice 4 notes and performance guide.

The user's verified packed-v2 desktop results are now recorded in `ANIMATION_PERFORMANCE.md`. Remaining work includes the full ordered paint/clip scene representation and eligibility rules, rendering fidelity, actual presented-pose synchronization, then editor integration. No saved-document or public runtime API changes are introduced by this worker slice.

Worker ownership reference: [MDN transferControlToOffscreen](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/transferControlToOffscreen).

Completion checks for slice 3: all **994 browser tests**, the production build, renderer/worker TypeScript check, and `git diff --check` passed. The default headless no-adapter run also completed with explicit GPU skips and SVG fallback. The worker lab bundle is separate from the editor production entry point.

## Slice 4: ordered static scenes, transforms and nested clips

`compilePolygonScene` now accepts normalized runtime scene targets and returns either a complete supported scene or explicit fallback reasons. It validates parent references/cycles, preserves sibling paint order, and composes parent/local transforms through the existing matrix kernel. Local vertices and their revisions stay resident when `updateTransform` changes a parent or clip source. Transform updates validate the complete result before publishing matrices. Geometry/setup/paint changes require a fresh compilation.

Supported scope: groups at opacity 1; rectangles and straight path fills/clips; nonzero and even-odd filling; canonical solid paints; centered strokes through the shared outline expansion kernel. A clipping source keeps clipping while hidden. With visible-source semantics, its fill paints below clipped children and its stroke above them, outside its own clip but inside ancestor clips. A rejected feature rejects the whole compilation: group isolation/opacity, combined fill+stroke element opacity, gradients, ellipse/text geometry, curved/rounded/revealed/derived-outline fills or clips, unsupported paint syntax, non-centered strokes, and unevaluated motion paths remain SVG work.

This is a **static normalized-scene subset**, not an importer eligibility check for every saved/imported SVG feature. It is not yet connected to rig-deformed full-scene animation or the editor renderer selector. Source-document/export diagnostics and animation-dependent eligibility must also gate that integration. The existing worker benchmark still draws its outline subset.

The GPU renderer consumes world matrices without repacking vertices and renders parent-first clip masks with per-sample intersection at 4× MSAA. Fill-rule selection changes the stencil read mask. Transparent output outside a clip still clears winding stencil, preventing leakage into subsequent objects. Clip textures resize with the drawing surface and are released when removed or the renderer is destroyed. Mask passes currently redraw every frame; mask storage is bounded to 256 MiB, 32 masks and 16 nested levels. The static compiler additionally rejects 256 or more signed fan triangles per draw as a conservative sufficient guard against winding wraparound. This bound deliberately rejects some safe complex geometry until a less conservative filling strategy is established. Raw outline-lab draws retain the earlier experimental winding limitation.

Open **Scene rendering preview** in the lab to inspect nested transformed clips, even-odd holes, reflected concave clipping, visible clip fill/stroke order, transparent layer order, and an explicit group-opacity fallback. The move slider updates parent matrices while retaining local geometry. The preview is separate from timed animation workloads. **Check pixels** includes independent checked-in SVG references plus retained transform, clip geometry, empty-mask and clip-resize cases. The report marker is `scene-clips-v4`.

Raster checks still exclude one-pixel SVG edge neighborhoods and allow 3/255 premultiplied-channel error. They establish interior parity for the tested cases, not complete antialiasing/large-coordinate/presentation parity. The next integration step is to connect ordered scene data to evaluated rig output, followed by curved fills and paint/compositing fidelity before editor adoption.

The user-supplied worker-v3 desktop measurements are recorded in `ANIMATION_PERFORMANCE.md`; CPU processing p95 was 9.2 ms with 0.1 ms main-thread dispatch and all 180 requests completed. Reference for per-sample clip intersection: [WGSL multisampled textures and textureLoad](https://gpuweb.github.io/gpuweb/wgsl/#textureload).

Slice 4 validation: **1,002 browser tests** passed (45 focused renderer/outline tests first), along with production build and renderer TypeScript checks. The isolated SwiftShader browser passed **28 SVG/GPU interior comparisons**, **21 worker readback comparisons** across replacement scenes, worker delivery/cancellation checks, and scene preview transform/fallback handlers. No uncaught browser exceptions were reported. `git diff --check` passed. These are correctness checks; desktop clipping costs and complete scene raster fidelity remain unmeasured.

## Slice 5: animated ordered rig scenes and explicit experimental opt-in

WebGPU remains experimental. The editor still renders SVG. The lab now starts in SVG mode with **Experimental WebGPU** unchecked; checking it enables the GPU comparisons. Disabling it stops preview delivery, terminates the worker, destroys GPU renderers and hides their surfaces while preserving SVG playback. All lab entry points, including retry, verification and the lazy scene preview, honor this opt-in. It is a lab-session setting, not a saved-document field or a nonfunctional editor preference. Editor rollout must retain the same explicit opt-in and whole-scene fallback policy.

`RigSceneEvaluation` now owns the shared framework-free rig/channel workspace for both the outline and ordered-scene workloads. It resolves bindings and rigid attachments once, delegates interpolation and dependent solves to the existing runtime kernel, resets authored channels on every seek and validates all rigs before consumers publish artwork. `AnimatedPolygonScene` checks existing runtime rig compatibility and supported channels, compiles paint/clip order once, and connects resolved outputs to `CompiledPolygonScene`.

The compiled scene stages changed fill/stroke/clip geometry and attachment matrices before publishing revisions. A projection or coordinate-limit failure restores pending source-coordinate changes and leaves the previously published drawing intact. Identical poses preserve revisions. Static artwork and rigid attachment vertices remain resident; only attachment matrices change. Fill and clip consumers of the same path share the projected geometry for that update. Animated transforms with automatic nontrivial origins remain unsupported until their dynamic bounds semantics are implemented.

New workloads **1 / 3 / 10 animated scene rigs** use a synthetic polygon character with dependent double IK, weighted filled/stroked artwork, a rigid attachment, an outer static clip and a root-bound moving clip. The editor-model reference and worker snapshot are separate consumers of the shared kernels. The same worker protocol now sends ordered draw and mask lists directly to GPU rendering without per-frame geometry transfers. Existing outline workloads remain available for longitudinal comparison. The report marker is `animated-scenes-v5`.

The animated SVG reference regenerates SVG markup and its DOM subtree each frame. It is a correctness reference and diagnostic workload, **not the retained editor SVG renderer or a valid editor speedup baseline**. Worker and main-thread GPU stage timings remain separately labeled. The 10-rig scene uses 20 clip masks; at 1380×1104 pixels these exceed the current 256 MiB mask budget, so it falls back explicitly. Smaller backing surfaces can run it (512×410 and smaller diagnostic surfaces were verified). Mask allocation/caching improvements are needed before claiming large-scene readiness at high DPR.

The saved document schema and public runtime entry points are unchanged. Renderer selection, overlay alignment, hit testing, editing/undo integration, curved fills, gradients and isolated compositing are still editor-rollout prerequisites. This slice does not silently omit unsupported artwork.

Slice 5 validation: all **1,010 browser tests**, the production build and renderer/worker TypeScript check passed. Strict SwiftShader verification passed **28 static SVG/GPU comparisons**, **21 animated SVG/GPU comparisons** across 1/3/10 rigs and sequential/backward/loop-boundary timestamps, and **49 worker readback comparisons** including workload replacement and experimental disable/re-enable. Final-sample delivery, cancellation and keyboard handlers also passed with no uncaught browser exceptions. These checks establish the tested interior-pixel and lifecycle behavior, not full antialiasing or compositor presentation parity. The separate 90-sample animated workload smoke completed successfully; its software-adapter instrumentation results are recorded in `ANIMATION_PERFORMANCE.md`.

## Slice 6: reuse clip textures after their final consumer

`ClipScheduleCache` snapshots draw-to-clip and clip-parent references. The plan survives pose, geometry, paint and surface changes and rebuilds when clip topology or paint dependencies change. It emits each needed mask immediately before first use, preserves artwork paint order and releases a texture slot only after its last sampling pass. Unused masks allocate no textures. Parents and children always use distinct slots during intersection, and masks referenced again later remain live. Arbitrary shared clip graphs can still require more slots than their nesting depth.

`WebGpuPolygonRenderer` owns the physical texture pool and sizes it to the schedule's peak live count. Mask and artwork passes interleave. Artwork passes preserve the multisample color surface with store/load operations and resolve only after the final paint batch; masks retain four samples per pixel. Every new mask clears its reused texture, including empty geometry. Resize, scene replacement and teardown release obsolete allocations. The 256 MiB budget now applies to simultaneously live mask slots; clip count/depth and other eligibility guards remain unchanged. Render-pass resource separation follows the [WebGPU usage-scope rules](https://gpuweb.github.io/gpuweb/#programming-model-resource-usages).

The ten-rig fixture at 1380×1104 now needs **2 mask textures / 48,752,640 bytes (46.5 MiB)** instead of 20 / 487,526,400 bytes (465 MiB): a 90% reduction in logical mask storage. This supersedes slice 5's fallback at that resolution. Color/stencil surfaces and driver overhead are outside that count. Pass interleaving adds color-surface store/load work, so this is a memory improvement, not an established GPU throughput improvement. No geometry, resolution, antialiasing or animation quality is reduced.

Reports use `pooled-clips-v6` and expose `clipMemory` for main-thread and worker GPU measurements. WebGPU remains off by default behind the lab's experimental checkbox; editor playback remains SVG. The user-supplied NVIDIA Ampere ten-rig result is recorded in `ANIMATION_PERFORMANCE.md`: CPU p95 2.0 ms on the main thread and 1.8 ms in the worker, 180/180 requests completed, zero superseded previews, and two mask textures at 1380×1104. GPU execution/presentation timing and broader renderer fidelity/interaction gates remain open; this is not a matched before/after speed comparison.

Slice 6 validation: **45 focused renderer/scene/queue tests** passed, including lifetime simulation over 100 varied clip trees and draw orders. Strict SwiftShader browser checks passed **30 static SVG/GPU comparisons**, **35 animated SVG/GPU comparisons**, and **49 worker readback comparisons** across replacements and experimental disable/re-enable. Seven animated comparisons and seven worker comparisons use ten rigs at 1380×1104. Shared parents, noncontiguous clip reuse, transparent overlap, empty recycled masks, changed paint order, resize, memory-budget rejection/recovery and empty-scene pool release are covered. Production build, renderer/worker TypeScript check and `git diff --check` passed. The full application suite was not rerun for this focused slice; slice 5's 1,010-test run remains the latest full-suite result.

## Slice 7: independent workload density and longer measurements

`scripts/renderer-lab/workloads.ts` is the single preset catalog for the selector and report. `AnimatedRigLabScene` now accepts bounded rig/moving-rig/path-density/path-count/static-layer options. It extends the same independent editor reference and framework-free worker snapshot; no alternative evaluator or production renderer behavior was added. Supported workloads separately increase polygon vertices (6/24/48), animated paths per rig (2/8/24), or static background layers (0/500/2,000). A combined preset uses twelve 24-vertex paths per rig. Nine static rigs plus one moving rig provide the static-surroundings comparison baseline. Reported target, draw, binding and clip counts make the workload explicit; see the table in `ANIMATION_PERFORMANCE.md`.

`BenchmarkRun` owns the bounded sample count, cancellable animation-frame waits and tab-visibility listener. The UI offers 180/1,800/7,200 samples per backend and defaults to 1,800; these are approximate 3/30/120-second sample windows at 60 Hz, not a fixed FPS cap. Each backend still calibrates and warms independently. Cancellation/hiding the tab stops the run without producing a completed report, drains pending worker promises and restores controls. Reports use `stress-scenes-v7` and include actual measured seconds. The command-line smoke runner accepts `--workload=<preset-id>` and `--samples=<count>` for repeatable measurement selection.

The 24-path layer stress case exposed SVG/GPU antialiasing differences on tightly overlapping stroke boundaries: one pixel at .12345 s differed by 4/255, and seven at 0 s by up to 5/255 on SwiftShader at 512×410. The image-gradient checker mistook these low-contrast boundaries for flat interiors. Stress verification now additionally identifies pixels within one backing pixel of independently editor-projected polygon edges, reports excluded geometry-boundary differences explicitly, and retains the 3/255 interior tolerance. Each stress comparison must still test more than 100 painted interior pixels. Existing baseline comparisons retain their prior image-edge classification. This is a correction to interior classification, **not a fix or acceptance of full antialiasing parity**; that renderer rollout gate remains open. Tests ensure the geometric classifier never excuses an incorrect interior color.

End-of-run `finalGpuDrainMs` reports waiting for outstanding GPU submissions, separately from CPU sample statistics. The worker's diagnostic final request renders the exact last timestamp and then drains its queue; ordinary playback requests keep submission-only acknowledgements. This neither measures per-frame GPU work nor confirms physical presentation. Software smoke previews are reduced to 256 pixels wide to keep correctness/instrumentation checks practical; explicit readback dimensions and the interactive hardware lab are unchanged.

The initial preview queues are drained before calibration, and GPU waits are cancellable without retracting submitted work. The software combined-workload run demonstrated why this matters: zero main-thread misses coexisted with an approximately eleven-second GPU queue tail. GPU backpressure during playback remains an open limitation, not a solved performance claim.

Slice 7 validation: **62 renderer/scene/queue/workload tests** passed, followed by a focused benchmark-lifecycle rerun with an additional cancellation-during-GPU-wait case. Production build, renderer/worker TypeScript check and `git diff --check` passed. The completed strict software-GPU browser run passed **30 static comparisons**, **59 animated/stress interior comparisons**, **77 worker readback comparisons**, preset replacement, long-run UI cancellation/restart and experimental opt-in teardown/re-enable. Known stress edge differences remain explicit in reports. A 30-sample combined workload completed and returned queue-drain metrics; hardware stress timings and full antialiasing parity remain pending. The full application suite was not rerun for this lab-focused slice.
