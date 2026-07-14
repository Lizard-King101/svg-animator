# Product Roadmap

The product direction is a **motion SVG studio**. Milestones are dependency-ordered; schema migration and safety work land before broader import/export formats.

## 1. Import and publish

1. ✅ Add a versioned document migration layer before expanding persisted saves.
2. ✅ Build a `DOMParser`-based SVG importer backed by conformance fixtures.
3. ✅ Sanitize the render representation and preserve unsupported safe content as opaque source nodes. Scripts, event attributes, and unsafe external resources never execute.
4. ✅ Ingest line, cubic, quadratic, arc, close, relative, and shorthand path commands.
5. 🔄 Convert preserved constructs found by the real-world corpus into native editable model coverage. Preservation remains a safety/round-trip fallback and is reported as partial import, not feature support.
6. ✅ Add the pure, deterministic `CompiledAnimationV1` boundary used to validate authoring/runtime equivalence.
7. Publish compiled animation as embedded JSON or external JSON and ship the lightweight standalone player.
8. Add a Font Awesome project preset and icon export with stroke-to-shape validation, naming, sizing, variants, and metadata.

References: [SVG paths](https://www.w3.org/TR/SVG/paths.html).

## 2. Drawing and SVG coverage

1. Canvas marquee selection, multi-object transforms, align/distribute, clipboard, and reusable symbols.
2. `line`, `polyline`, `polygon`, nested `svg`/`viewBox`, `defs`, `symbol`, and reusable `use` semantics. Local `use` references to editable geometry already normalize to independent editable groups.
3. Full boolean operations and primitive/path conversion.
4. ✅ Native alpha, fill/stroke opacity, stroke alignment, dashes, caps/joins, and miter limits. Markers, vector effects, and paint order remain planned.
5. ✅ Editable linear/radial gradients, including timeline animation for geometry and stops. Reusable patterns remain planned.
6. Images, embedded fonts, richer `tspan`, text-on-path, masks, filters, blend modes, metadata, and accessibility properties.
7. Maintain native-edit, opaque-preservation, round-trip, and visual-rendering fixture corpora.

References: [SVG structure](https://www.w3.org/TR/SVG2/struct.html), [SVG paint servers](https://www.w3.org/TR/SVG/pservers.html).

## 3. Procedural animation and rigging

1. ✅ Ship numeric speed-graph editing with easing-preset compatibility, temporal speed/influence handles, semantic X/Y pairing, and per-channel retiming.
2. Add editable markers, named clips, ping-pong, triggers, runtime-variable controls, and state transitions.
3. Define a versioned typed expression AST/DAG; ship a text DSL first and make a future node editor read/write the same model.
4. Add constants, typed variables, time/property references, math, conditionals, seeded noise/random, registered safe functions, cycle diagnostics, and deterministic topological evaluation.
5. Use fixed seeds by default. An explicit `randomizeOnLoad` player option may vary playback; baking records the effective seed.
6. Add fixed-timestep live physics plus bake-to-keyframes: springs, damping, inertia, gravity, pendulum/secondary motion, and follow constraints.
7. Add controls, parenting, transform/path constraints, bones, weighted path-point deformation, FK, IK, and rig presets.
8. Compose expressions, physics, constraints, and ordinary keyframes through one property-evaluation pipeline.
