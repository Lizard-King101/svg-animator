# Animation Guide

This guide covers the shipped timeline and speed-graph workflow. Authored animation can be published as an Embedded Animation SVG for a shared player, a self-contained Animated SVG, external runtime assets, or a ready-to-run Web Bundle.

## Make a first animation

1. Draw or select an element and switch from **Edit** to **Animate**.
2. Expand the element in the timeline, then find a property such as **Offset X**, **Offset Y**, **Rotation**, or **Opacity**.
3. Move the playhead and use the diamond beside a property to add or remove a keyframe. Changing a timeline property value at the playhead also creates or updates its keyframe.
4. Add another key at a later time with a different value.
5. Press **Play**, or drag the ruler/playhead to scrub.

The numeric field beside a property has two interactions:

- Click without dragging to focus it, select its contents, and type an exact value.
- Drag horizontally to scrub the value. Hold Shift for coarse changes or Alt/Option, Ctrl, or Command for fine changes.

One drag is one undo step. Undo and redo refresh the artwork, preview, and displayed field value together.

## Timeline controls

| Action | Control |
|---|---|
| Scrub time | Drag the ruler or the empty graph surface |
| Zoom time around the pointer | Wheel over the time lanes or graph |
| Pan time | Middle-mouse drag horizontally over the lanes/graph |
| Scroll timeline rows | Middle-mouse drag vertically over timeline lanes |
| Pan the graph's speed range | Middle-mouse drag vertically over the graph |
| Zoom graph speed around the pointer | Ctrl/Command + wheel over the graph |
| Fit the full duration | Timeline **Fit duration** button |
| Fit visible graph speeds | Graph **Fit** button |
| Resize the timeline | Drag its top resize handle |

Wheel and middle-mouse gestures apply only to the lane/graph side. The Layers and property-value column stays in place.

Collapsed layer rows show one visual summary diamond for each time containing keys below that layer. Summary diamonds are deliberately not selectable or clickable. Expanding the layer hides its summaries and reveals the real property keys.

## Selecting and retiming keys

- Click a key to select it; Shift-click toggles it in the selection.
- Drag selected keys horizontally to retime them while preserving their relative spacing.
- Use Left/Right Arrow for a small nudge and Shift + Left/Right Arrow for a larger nudge.
- Use Command/Ctrl+C and Command/Ctrl+V to copy and paste keys.
- Press Delete or Backspace to remove selected keys.
- Drag an empty lane area to marquee-select keys; hold Shift to add to the selection.
- Press Escape during a key drag to restore the starting times.

Each track remains sorted with one keyframe per timestamp. If a retimed key collides with another key on the same track, the dragged key replaces the destination deterministically.

In Graph mode, drag a key's root node horizontally to retime only that numeric channel. X and Y roots are independent even when both curves are overlaid: X uses round nodes and Y uses square nodes.

## Timeline versus Graph mode

Use the **Timeline / Graph** switch in the toolbar:

- **Timeline** shows property lanes and keyframe timing.
- **Graph** replaces the lanes with a speed graph while retaining the layer/property list, ruler, playhead, time zoom, and aligned scrolling.

The graph accepts numeric properties. Color, boolean, and other discrete properties continue to use the preset easing buttons in the timeline.

Selecting a compatible numeric property automatically overlays its semantic partner on the same scale:

- Translate X/Y
- Scale X/Y
- Origin X/Y
- Motion Offset X/Y
- Each path point's X/Y coordinates
- Gradient `x1/y1`, `x2/y2`, `cx/cy`, and `fx/fy`

The legend, curve color, and node shape identify each channel. Radius, rotation/angles, opacity, stroke width, draw/motion progress, and gradient-stop offsets remain single-channel graphs.

## Reading and editing the speed graph

The vertical axis is instantaneous property units per second. Zero is always visible; positive and negative speeds may cross it, and custom handles may intentionally overshoot the values between keys.

Each segment has an outgoing handle on its source key and an incoming handle on its destination key:

- Drag vertically to change **Speed**.
- Drag horizontally to change **Influence**, the fraction of that adjacent segment controlled by the handle.
- Use the toolbar fields for exact Speed and Influence values.
- Shift-select compatible handles, then drag to apply relative speed/influence changes while keeping their differences.
- Linked handles share speed across a key, but incoming and outgoing influences remain independent.
- Alt/Option-drag a handle to break its link.
- Click **Link** to relink it; the active handle's speed is copied to the opposite side without changing either influence.
- Press Escape during a handle drag to restore the starting tangents.

Preset easing stays exact until a segment is customized. Editing a preset segment initializes equivalent temporal handles. Applying a preset again clears custom temporal data on the affected segment.

## Example: a bouncing ball

A convincing bounce is easiest when X and Y do different jobs:

- X controls steady travel across the canvas.
- Y controls gravity, impacts, and successively lower arcs.

Create four Translate X and Translate Y keys:

| Key | Time | X | Y | Meaning |
|---|---:|---:|---:|---|
| 1 | `0.00` | `80` | `80` | Starting apex |
| 2 | `0.60` | `200` | `300` | First impact |
| 3 | `1.00` | `280` | `170` | Lower apex |
| 4 | `1.40` | `360` | `300` | Second impact |

SVG Y increases downward, so falling has positive Y velocity and rising has negative Y velocity.

1. Keep the X curve near a constant positive speed. A linear preset is a useful start.
2. On Y, make the starting apex close to zero speed, then increase to a large positive speed before the first impact.
3. Break the Y handles at the first impact. Keep the incoming speed strongly positive and make the outgoing speed strongly negative; this creates the sharp direction change.
4. Bring Y speed back to zero at the second apex.
5. Increase it positively again into the second impact.
6. Shorten the second arc and reduce its height to imply energy loss.

The impact is physically discontinuous, so broken handles are appropriate there. The apex should feel smooth and nearly stationary, so linked or matched zero-speed handles work well. Drag the X or Y root independently if one channel needs different timing.

## What gets saved

Editor projects keep rich, editable keyframes and temporal handles in animation schema v2. Existing projects with preset easing load without temporal handles and retain their original appearance. Preview values are temporary and never overwrite the saved base artwork.

The project card's three-dot menu exports the editable v5 Project JSON and remains available when invalid or orphaned tracks prevent runtime publishing; use it for reproducible parity fixtures. The editor Export dialog separates script-free Static SVG artwork from animated delivery formats. Animated/runtime exports always use the complete project duration (not the editor work area), preserve negative and after-duration keys, and reject enabled invalid/orphaned tracks before download. Trim to the work area explicitly if that is the intended published duration. See [the runtime guide](docs/RUNTIME.md) for controls, embedding, MIME types, reduced motion, CSP, and cleanup, and [the runtime testing guide](docs/RUNTIME_TESTING.md) for turning a real project into a regression fixture.

For implementation details, see [ANIMATION_MVP.md](ANIMATION_MVP.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ANIMATION_PERFORMANCE.md](ANIMATION_PERFORMANCE.md).
