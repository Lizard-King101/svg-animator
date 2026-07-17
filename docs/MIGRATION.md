# Runtime migration guide

## Initial v1 release

The editor application and runtime begin at 1.0.0. Existing editable projects remain document envelope v5 and animation schema v2; no persisted field migration is required. The former internal `CompiledAnimationV1` payload is replaced at the export boundary by `RuntimeBundleV1`, and diagnostics are returned separately as `RuntimeCompileResultV1.diagnostics`.

Consumers may mount exported `artwork.svg` with its matching `animation.json` through `createPlayer`, or mount an Embedded Animation SVG through `createEmbeddedPlayer`. Call `destroy()` during teardown. Static SVG remains unchanged. Use a self-contained Animated SVG only in script-capable embedding contexts.

For a future format upgrade, update the player first, verify the old immutable fixture through its adapter, regenerate the API report and schema, then update export generation. Never rewrite editable projects merely to cache runtime output.
