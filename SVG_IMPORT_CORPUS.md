# SVG Import Corpus

The files in `SVG Samples/` are test-only assets and do not ship in the production bundle. Every sample runs through the real browser `DOMParser`, sanitizer, native importer, save/reload path, and static exporter. A sample is fully imported only when its retained artwork and dependencies are editable model objects; visually preserved source is explicitly partial.

| Sample | Editable | Preserved | Removed | Coverage |
|---|---:|---:|---:|---|
| `alphachannel.svg` | 3 | 0 | 0 | Element opacity and overlapping color |
| `bzr.svg` | 4 | 0 | 0 | Cubic path geometry |
| `clippath.svg` | 15 | 2 | 0 | Native clip groups, expanded local `use`, compound/nested clips; Gaussian blur remains preserved |
| `samples-svgrepo-com.svg` | 14 | 0 | 0 | Typical icon-style path artwork |
| `snake.svg` | 15 | 0 | 2 | Script and root event removal |
| `photos.svg` | 1 | 0 | 2 | Script-generated external images; executable generation is intentionally discarded |
| `Steps.svg` | 32 | 1 | 8 | Scripts, event handlers, symbols, and game artwork |
| `car_stress_test.svg` | 247 | 147 | 0 | 527 KB Inkscape artwork; 100+ gradients are native, while filters and dash styling dominate the remaining fallback |

Counts are a diagnostic snapshot. Tests enforce minimum editable counts and maximum preserved counts, so native coverage cannot silently regress. Each reduction in the preserved column must correspond to native model, editing, persistence, animation compatibility, and export coverage—not merely successful rendering.
