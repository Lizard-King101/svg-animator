# SVG Import Corpus

The files in `SVG Samples/` are test-only assets and do not ship in the production bundle. Every sample runs through the real browser `DOMParser`, sanitizer, native importer, save/reload path, and static exporter.

| Sample | Editable | Preserved | Removed | Coverage |
|---|---:|---:|---:|---|
| `alphachannel.svg` | 3 | 0 | 0 | Element opacity and overlapping color |
| `bzr.svg` | 4 | 0 | 0 | Cubic path geometry |
| `clippath.svg` | 2 | 4 | 0 | Filters, clip paths, definitions, and `use` |
| `samples-svgrepo-com.svg` | 14 | 0 | 0 | Typical icon-style path artwork |
| `snake.svg` | 15 | 0 | 2 | Script and root event removal |
| `photos.svg` | 1 | 0 | 2 | Script-generated external images; executable generation is intentionally discarded |
| `Steps.svg` | 32 | 1 | 8 | Scripts, event handlers, symbols, and game artwork |
| `car_stress_test.svg` | 107 | 287 | 0 | 527 KB Inkscape artwork with hundreds of gradients and complex styling |

Counts are a diagnostic snapshot, while tests use conservative minimums where future native coverage may legitimately convert more preserved nodes into editable elements.
