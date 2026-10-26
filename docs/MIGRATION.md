# Runtime migration guide

## Runtime 1.5 and document 17: visible clipping artwork

Clipping sources now use their normal `visible` flag for painted artwork only. The clipping geometry remains active, with source fill behind clipped children and source outline above them. New runtime bundles declare `render.visible-clipping-v1`; use runtime 1.5 or later. Older bundles without this capability retain their prior clipping behavior.

Document envelope 17 migrates each legacy clipping source to `visible: false`, preserving the previously unpainted source. Legacy scene and reusable-action `visible` channels targeting those sources retain their track IDs, key IDs, timing, enabled state and scopes, with key values set to false so later playback cannot unexpectedly reveal artwork. Other visibility channels, geometry, bindings, weights and locks remain unchanged. To animate source appearance in the new workflow, edit its visibility keys explicitly. Animation schema remains 2 and rig schema remains 5. Current documents preserve the authored eye-toggle state without repeating the legacy migration.

## Runtime 1.4: outline sections and explicit closure

Publish custom outlines with runtime 1.4 or later and the `render.outline-sections-v1` capability. Bundle format remains 1. Optional path section metadata references existing contours and segments, including implicit closing edges; the generated stroke is recomputed after animation and rig deformation. An absent list retains the legacy stroke; an empty list hides only the stroke. A newly explicit-open coincident contour carries `explicitClosure` and the same capability. Older portable bundles retain inferred closure when neither new field is present.

Document envelope 16 introduces optional outline sections and canonical explicit closure. Migrating older documents converts previously inferred coincident closure into `closed: true`, preserving their appearance and valid binding topology signatures. Newly open contours stay open even when their endpoint positions coincide. No weights, locks, animation keys or rig assignments are initialized or discarded by this migration. Rig schema remains 5 and animation schema remains 2.

## Runtime 1.3: animated rigs

Upgrade the player to 1.3 before publishing bundles with `rig.pose-v1`. Bundle format remains 1; the optional `rigs` payload carries captured rest data, bindings and constraints, while ordinary numeric tracks target armature IDs with `bones.<boneId>.pose`, `poseX`, and `poseY`. Reusable actions retain source curves, timing, rate and repeats. Existing bundles need no conversion. Static SVG continues to consume materialized artwork without rig metadata.

The editor's document envelope 15 marks bone-channel support and keeps animation schema 2 and rig schema 5. Migration preserves existing static poses, bindings and action data. An older editor must reject this envelope rather than strip unknown bone channels.

## Initial v1 release

The editor application and runtime begin at 1.0.0. Existing editable projects remain document envelope v5 and animation schema v2; no persisted field migration is required. The former internal `CompiledAnimationV1` payload is replaced at the export boundary by `RuntimeBundleV1`, and diagnostics are returned separately as `RuntimeCompileResultV1.diagnostics`.

Consumers may mount exported `artwork.svg` with its matching `animation.json` through `createPlayer`, or mount an Embedded Animation SVG through `createEmbeddedPlayer`. Call `destroy()` during teardown. Static SVG remains unchanged. Use a self-contained Animated SVG only in script-capable embedding contexts.

For a future format upgrade, update the player first, verify the old immutable fixture through its adapter, regenerate the API report and schema, then update export generation. Never rewrite editable projects merely to cache runtime output.
