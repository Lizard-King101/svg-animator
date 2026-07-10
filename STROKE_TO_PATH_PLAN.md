# Stroke To Path Plan

## Findings

- Exact offsets of cubic bezier curves are generally not cubic beziers. A cubic bezier offset can be a higher-degree algebraic curve, so practical editors approximate offset curves.
- The right practical strategy is adaptive subdivision plus curve fitting:
  - split source curves where curvature changes too much;
  - compute offset endpoints and offset tangents from source derivatives;
  - fit one or more cubic beziers to each offset side;
  - validate error against sampled offset points and subdivide again when needed.
- Caps and joins are separate geometry:
  - butt and square caps can be line segments;
  - round caps and round joins can use cubic arc approximations;
  - miter joins need a miter-limit fallback to bevel or round.
- Closed stroked paths need compound output: an outer contour and an inner contour. That is why compound paths are a prerequisite for good stroke conversion.

References:
- https://en.wikipedia.org/wiki/Parallel_curve
- https://en.wikipedia.org/wiki/B%C3%A9zier_curve#Offsets_(or_stroking)_of_B%C3%A9zier_curves
- https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm
- https://en.wikipedia.org/wiki/Cubic_Hermite_spline

## Compound Path V1

- `Path` now stores `contours`, each with its own `closed` flag and segment list.
- `Path.lines` and `Path.closed` remain compatibility accessors for the primary contour so existing pen/select editing keeps working.
- SVG rendering/export emits one `<path>` with multiple subpaths and `fill-rule="evenodd"`.
- The layer menu can combine multiple selected path layers into the right-clicked target path. Source path transforms are baked into the target path's local coordinates before appending contours.

## Stroke Conversion Next Steps

1. Keep the current polyline converter as a fallback/debug path.
2. Add cubic utilities:
   - evaluate cubic at `t`;
   - derivative at `t`;
   - de Casteljau split at `t`;
   - normal from derivative;
   - cubic-from-Hermite helper.
3. Implement offset fitting for one cubic segment:
   - get offset endpoint positions at `t=0` and `t=1`;
   - get endpoint tangent directions from source derivatives;
   - fit a cubic with Hermite controls;
   - sample midpoint and quarter points to estimate error.
4. Adaptive subdivision:
   - if error exceeds tolerance, split source cubic and fit both halves;
   - use a user-facing tolerance later, but start with an icon-friendly default.
5. Build full outlines:
   - left offset contour in source direction;
   - cap/join geometry;
   - right offset contour in reverse direction;
   - for closed paths, append inner and outer contours to one compound path.
6. Add compound path editing follow-ups:
   - select/edit non-primary contours;
   - reorder contours;
   - split a contour back into a separate layer.

## V1 Limitations

- Boolean cleanup for self-intersecting outlines is out of scope until we add or implement a robust polygon/curve boolean layer.
- Exact offset math is out of scope; the goal is clean, compact, visually faithful cubic approximation.
- Current compound editing remains primary-contour-focused; combined contours render/export correctly but deep editing can follow after stroke conversion stabilizes.

## Conversion Profiles

- `Precise` preserves every segment produced by adaptive offset subdivision and remains the comparison baseline.
- `Optimized` uses the same offset tolerance, then removes zero-length lines and merges only straight spans whose complete line/bezier control hull stays within a bounded distance of one chord.
- The cleanup tolerance is capped by the offset fitter tolerance and scales conservatively with stroke width. Curved spans, round caps, and round joins are left intact.
- Keeping both profiles in the layer menu supports visual A/B testing and direct segment-count comparison without changing source artwork.
