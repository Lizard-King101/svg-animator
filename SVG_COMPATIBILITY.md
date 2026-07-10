# SVG Compatibility Matrix

Legend: **Native** = editable model (including import normalization); **Render/export** = generated correctly from native state; **Preserve** = sanitized source survives import/save/reload/export when it cannot be made native.

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
| `symbol`, `use` | No | Source | Yes | Reusable-symbol editing remains planned |
| Clipping paths | Yes | Yes | Yes | Existing native clips; imported clip constructs remain source |
| Masks | No | Source | Yes | Distinct from clipping |
| Solid fill/stroke | Yes | Yes | Yes | Hex, RGB, and browser-recognized solid colors |
| Gradients/patterns | No | Source | Yes | Paint-server editing remains planned |
| Dashes/markers/vector effects | No | Source | Yes | Style-depth milestone |
| Images | No | Source | Yes | External references are stripped; safe embedded raster data is retained |
| Filters/blend modes | No | Source | Yes | Sanitized before rendering |
| Metadata/accessibility | Partial | Partial | Partial | Title can name a document; richer metadata remains planned |
| SMIL/CSS/script animation | No | No | Rejected | Active elements and stylesheets are removed before persistence |
| Editor animation JSON/runtime | Native model | Static SVG only | N/A | Publish formats are roadmap milestone 1 |

## Import safety policy

The importer parses text with `DOMParser`; imported nodes are never inserted as live, unsanitized DOM. Scripts, event-handler attributes, stylesheets, SVG animation elements, foreign content, unsafe URLs, and active external resources are rejected. Unsupported safe content retains sanitized source while the same sanitized representation is used for rendering.

## Fixture requirements

Each supported family needs fixtures for native editing, save/reload, exported markup, and representative visual output. Unsupported families need opaque-preservation and sanitizer fixtures before they can be advertised as preserved.

The maintained real-world corpus and current diagnostic baseline are documented in [SVG_IMPORT_CORPUS.md](SVG_IMPORT_CORPUS.md).
