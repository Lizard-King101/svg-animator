# Compatibility policy

The editor app and standalone runtime are independently versioned with SemVer. Removing or renaming runtime exports, changing method/event semantics, narrowing accepted inputs, or changing defaults is breaking. Public API is deprecated for at least one minor release before removal in the next major, with a replacement recorded in the changelog and migration guide.

`RuntimeBundleV1` uses integer format version 1. Optional metadata is additive. Required structural or semantic changes increment the format. Each runtime major supports its own bundle generation and the immediately previous generation through explicit adapters. Unsupported capabilities and future formats fail before SVG mutation.

Persisted editor documents use sequential migrations indefinitely. Unknown future versions are never overwritten, and compiled runtime caches are never persisted in editable documents. Before changing a document, animation, bundle, or API contract: freeze the old fixture; add migration/adapter coverage; update schema, API report, changelog, and migration docs; then bump the applicable version.

The private registry package name is not a compatibility contract. `SVGAnimatorRuntime` is stable and must remain as an alias after any rebrand.
