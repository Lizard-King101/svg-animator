# Runtime release checklist

- Confirm editor and runtime SemVer bumps are independent and appropriate.
- Freeze any previous document, animation, bundle, or API representation before changing it.
- Update adapters/migrations, JSON Schema, API report, changelog, and migration guide.
- Regenerate and review runtime showcase golden outputs and ZIP manifest.
- Promote unresolved user-project export differences to immutable Project JSON parity fixtures using `RUNTIME_TESTING.md`.
- Run `npm run verify`, `npm test -- --watch=false`, `npm run build`, and `git diff --check`.
- Confirm ESM import, `SVGAnimatorRuntime`, external assets, Embedded Animation SVG, and self-contained Animated SVG examples.
- Confirm capability/version/signature errors occur before DOM mutation.
- Confirm the minified runtime carries the MIT banner and passes the gzip budget.
- Verify MIME/CSP/embedding guidance and package privacy before publishing artifacts.
