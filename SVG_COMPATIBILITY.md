# SVG Compatibility Matrix

Legend: **Native** = editable model (including import normalization); **Render/export** = generated correctly from native state; **Preserve** = sanitized source survives import/save/reload/export when it cannot be made native. Preservation is a compatibility fallback and is reported as a **partial import**, not native support.

| SVG family | Native | Render/export | Preserve on import | Notes |
|---|---:|---:|---:|---|
| `svg`, `viewBox` | Partial | Yes | Yes | Root viewBox and non-zero origins normalize; nested SVG is preserved |
| `g` | Yes | Yes | Yes | Nested groups and decomposable transforms |
| `defs` | Partial | Yes | Yes | Generated clipping is native; general definitions remain source |
| `path` (`M/L/C/Z`) | Yes | Yes | Yes | Straight/cubic editing and compound contours |
| Path `H/V/Q/T/S/A`, relative commands | Via normalization | Yes | Yes | Converts to native line/cubic contours |
| `rect`, `ellipse` | Yes | Yes | Yes | Rectangle radii supported |
| `circle` | Via ellipse | Via ellipse | Yes | No distinct native type |
| `line`, `polyline`, `polygon` | Via path | Yes | Yes | Converts to editable path segments |
| `text`, basic `tspan` | Partial | Yes | Yes | Plain text imports; rich layout remains source |
| `symbol`, `use` | Partial | Yes | Yes | Local `use` of editable geometry expands to editable groups; reusable symbol semantics remain planned |
| Clipping paths | Yes | Yes | Yes | Local `clipPath` geometry, compound unions, and nested intersections normalize to editable clipping groups |
| Masks | No | Source | Yes | Distinct from clipping |
| Solid fill/stroke | Yes | Yes | Yes | Hex, RGB/RGBA, alpha-aware picking, and browser-recognized solid colors |
| Linear/radial gradients | Yes | Yes | Yes | References normalize to editable per-element paints; direct canvas handles and stop popovers edit inheritance-normalized geometry and alpha-aware stops |
| Patterns | No | Source | Yes | Reusable pattern editing remains planned |
| Dashes/markers/vector effects | No | Source | Yes | Style-depth milestone |
| Images | No | Source | Yes | External references are stripped; safe embedded raster data is retained |
| Filters/blend modes | No | Source | Yes | Sanitized before rendering |
| Metadata/accessibility | Partial | Partial | Partial | Title can name a document; richer metadata remains planned |
| SMIL/CSS/script animation | No | No | Rejected | Active elements and stylesheets are removed before persistence |
| Editor animation JSON/runtime | Native model | Static SVG only | N/A | Gradient geometry is grouped like path shape; stop offsets and alpha-aware colors use a compact timeline popover |

## Import safety policy

The importer parses text with `DOMParser`; imported nodes are never inserted as live, unsanitized DOM. Scripts, event-handler attributes, stylesheets, SVG animation elements, foreign content, unsafe URLs, and active external resources are rejected. Unsupported safe content retains sanitized source while the same sanitized representation is used for rendering. Any retained source node makes the result a partial import because that node cannot yet be edited through the native model.

## Fixture requirements

Each supported family needs fixtures for native editing, save/reload, exported markup, and representative visual output. Unsupported families need opaque-preservation and sanitizer fixtures, and every preserved real-world construct is treated as input to the native-coverage backlog.

The maintained real-world corpus and current diagnostic baseline are documented in [SVG_IMPORT_CORPUS.md](SVG_IMPORT_CORPUS.md).
