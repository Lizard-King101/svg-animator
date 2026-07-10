# SVG Compatibility Matrix

Legend: **Native** = editable model; **Render/export** = generated correctly from native state; **Preserve** = planned opaque round-trip for imported unsupported content.

| SVG family | Native | Render/export | Preserve on import | Notes |
|---|---:|---:|---:|---|
| `svg`, `viewBox` | Partial | Yes | Planned | One document root; nested SVG planned |
| `g` | Yes | Yes | Planned | Nested groups and transforms |
| `defs` | Partial | Yes | Planned | Generated for clipping; general defs planned |
| `path` (`M/L/C/Z`) | Yes | Yes | Planned | Straight/cubic editing and compound contours |
| Path `H/V/Q/T/S/A`, relative commands | No | No | Planned | Import normalization planned |
| `rect`, `ellipse` | Yes | Yes | Planned | Rectangle radii supported |
| `circle` | Via ellipse | Via ellipse | Planned | No distinct native type |
| `line`, `polyline`, `polygon` | No | No | Planned | Roadmap milestone 2 |
| `text`, basic multiline `tspan` | Yes | Yes | Planned | Rich tspans/text path planned |
| `symbol`, `use` | No | No | Planned | Reusable-symbol milestone |
| Clipping paths | Yes | Yes | Planned | One clipping element per group |
| Masks | No | No | Planned | Distinct from clipping |
| Solid fill/stroke | Yes | Yes | Planned | Caps, joins, width supported |
| Gradients/patterns | No | No | Planned | Paint-server milestone |
| Dashes/markers/vector effects | No | No | Planned | Style-depth milestone |
| Images | No | No | Planned | Unsafe external loads must be blocked |
| Filters/blend modes | No | No | Planned | Sanitized rendering required |
| Metadata/accessibility | No | No | Planned | Includes title/desc/ARIA metadata |
| SMIL/CSS/script animation | No | No | Planned opaque only | Active content never executes in-editor |
| Editor animation JSON/runtime | Native model | Static SVG only | N/A | Publish formats are roadmap milestone 1 |

## Import safety policy

The future importer parses text with `DOMParser`; imported nodes are never inserted as live, unsanitized DOM. Scripts, event-handler attributes, unsafe URLs, and active external resources are rejected. Unsupported safe content may retain opaque source for round-trip while a sanitized representation is used for rendering.

## Fixture requirements

Each supported family needs fixtures for native editing, save/reload, exported markup, and representative visual output. Unsupported families need opaque-preservation and sanitizer fixtures before they can be advertised as preserved.
