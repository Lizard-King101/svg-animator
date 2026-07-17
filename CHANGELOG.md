# Changelog

## 1.0.0 - 2026-07-16

- Establish editor application SemVer 1.0.0 and private runtime SemVer 1.0.0.
- Add deterministic `RuntimeBundleV1`, JSON Schema, capability and artwork validation, and separate compiler diagnostics.
- Add dependency-free typed ESM and `SVGAnimatorRuntime` browser players with playback, events, markers, reverse/rate/loop controls, reduced-motion autoplay handling, multiple instances, and destroy/restore behavior.
- Add editable Project JSON, Static SVG, Embedded Animation SVG, self-contained Animated SVG, Runtime Assets ZIP, and Web Bundle ZIP exports.
- Add `createEmbeddedPlayer` for mounting artwork with inert embedded `RuntimeBundleV1` data through one shared external runtime.
- Separate static and animated publishing choices, and move editable Project JSON export to the home project-card actions menu alongside deletion.
- Add reusable real-Chrome editor/runtime DOM parity coverage and fixture-capture guidance for user project reproductions.
- Preserve document envelope v5 and animation schema v2, including negative and after-duration keys.
