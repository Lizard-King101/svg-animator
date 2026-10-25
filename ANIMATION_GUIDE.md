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

## Onion skins and motion trails

In Animate mode, use the inspection row beneath the timeline toolbar:

- **Onion skins** shows up to two earlier poses in teal and two later poses in amber. Adjust **Spacing (s)** to compare nearby poses or larger changes. Select artwork to isolate it; clear the selection to inspect animated artwork across the scene. Samples stop at the document boundaries rather than wrapping through a loop.
- **Motion trails** traces the transform origins of up to eight selected objects across the full document duration. Dots carry time labels where there is room, and the filled marker shows the current time. An object that only rotates around a fixed origin may have no trail; use onion skins to inspect that rotation or shape deformation.
- Both aids follow canvas pan/zoom, ignore pointer input, and disappear during playback or in Edit mode. They return when paused. They are inspection tools, so toggling them creates no undo entry and does not affect saved artwork or exports.

Trails use 60 equal time intervals and are visual guides, not exact editable trajectories. Invisible sampled poses break the trail. Settings last for the current editor session. Ghost images exclude tracing references; text relying on external fonts/resources can differ because ghosts are isolated SVG images.

## Actions and scene placements

In Animate mode, select artwork (a group includes its current descendants), enter an action name, and choose **New action from selection**. **Extract selected motion** moves that selection's direct scene tracks into a source. The editing-context selector switches between **Scene** and a named **Action**. The source has its own duration and local playhead; existing canvas, keyframe, graph, paint, onion-skin and trail tools edit/inspect that source. Other artwork remains visible for reference. Scope is captured at creation; later-added objects are not automatically bound.

Use **Back to scene**, choose an action under **Place**, then **Place at playhead**. Change a block's **Start** time and leave the field or press Enter to commit; Escape cancels the typed change. **Repeat** creates another linked placement immediately after the block. Click its source-name button to edit the action. Every linked placement uses the updated source. **Duplicate source** creates independent keys without changing existing links. Deleting a source also removes its placements in one undoable operation.

Blocks default to one full-source play at 1× speed. Each placement has **In** and **Out** in source-local seconds, **Rate** (0.01–100×), and **Loops** (1–10000 whole repetitions). Its scene length is `(Out − In) × Loops ÷ Rate`. Enter or leaving the field commits; Escape cancels. Invalid ranges, rates, loop counts or overlaps leave the prior timing intact. **Repeat** copies these settings into a separate linked placement immediately after the current block. The start is inclusive and the end exclusive: at the end, affected channels return to direct scene animation or base artwork. Different actions on the same artwork may overlap when they animate different channels, such as translation and opacity. Competing channels, frame/point geometry edits, and overlapping copies of the same source are rejected. Later source edits that introduce a conflict restore the last committed animation and explain the conflict. The scene extends when a placement needs more time. Placement rows share the keyframe timeline ruler, horizontal scroll and zoom; their controls stay pinned at the left. Vertical scrolling includes both placements and keyframes. Drag blocks to change their start; either edge snaps to the playhead and other block edges within eight screen pixels. Hold Alt to bypass snapping. Escape, pointer cancellation or window blur cancels the draft. Focus a block and use Left/Right for 0.01s nudges or Shift for 0.1s; Enter previews its start. Each completed move is one undo step. Trimming is non-destructive and does not change the source keys. A loop restarts at In and excludes Out; after the final loop, scene values resume. Drag the narrow handles just outside either block edge to trim. The opposite scene edge stays fixed; trimming a repeated block adjusts every cycle equally while preserving rate and loop count. Handles snap to the playhead and neighboring edges; Alt bypasses snapping. Focus a handle and use Left/Right for 0.01 scene-second changes, or Shift for 0.1. Escape, pointer cancellation and window blur discard the draft. Source bounds and a nonempty interval limit trims; overlaps are rejected on release. Reverse playback, ping-pong, blending and stretch handles remain follow-ups.

Project JSON and reopening retain sources and links. Animated SVG/ZIP exports render the scene, even while editing an action; runtime 1.2 or later is required for placements using trims, rates or loops; older full-source composition still requires 1.1. Editable documents now save as version 13, preserving older projects through migration. Static SVG still exports base artwork. Trim-to-work-area is currently limited to direct animation.

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

The project card's three-dot menu exports editable Project JSON (currently document v13) and remains available when invalid or orphaned tracks prevent runtime publishing; use it for reproducible parity fixtures. The editor Export dialog separates script-free Static SVG artwork from animated delivery formats. Animated/runtime exports always use the complete project duration (not the editor work area), preserve negative and after-duration keys, and reject enabled invalid/orphaned tracks before download. Trim to the work area explicitly if that is the intended published duration. See [the runtime guide](docs/RUNTIME.md) for controls, embedding, MIME types, reduced motion, CSP, and cleanup, and [the runtime testing guide](docs/RUNTIME_TESTING.md) for turning a real project into a regression fixture.

For implementation details, see [ANIMATION_MVP.md](ANIMATION_MVP.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ANIMATION_PERFORMANCE.md](ANIMATION_PERFORMANCE.md).

## Armatures, FK/IK and point weights

In **Edit** mode, choose the **Bone** tool and drag on the canvas. The first stroke creates an armature with a named point root and a diamond bone. Each completed bone becomes the parent of the next one; select an earlier bone in Layers or on the canvas to branch. Shift constrains drawing to 15° steps. Click to place a circle-crosshair point bone; drag at least five screen pixels to create a length bone. Small click jitter stays a point, independent of zoom. Escape, focus loss, changing tools or history cancels an unfinished stroke. Bones share the existing Layers panel; new armatures can also be created there. Choose Select and the rig’s **Edit** workspace to drag roots and bone bodies, or drag tips to aim and resize. Numeric joint fields remain available. **New armature** creates and selects a movable root and switches back to Edit/Select.

Rename bones or armatures directly in Layers with a double-click or F2; Enter/blur commits and Escape cancels. Drag the grip to reorder rows; drop in the middle of a bone row to parent under it. Armature rows reorder independently; bones stay within their armature. Alt+Up/Down reorders siblings from the keyboard, and Escape cancels a drag. The trash button deletes a bone or armature. The row’s **⋯** menu (also right-click or Shift+F10) provides **Move under**, unlinking, and deletion. Reparenting preserves the visible skeleton and artwork. Root rows offer **Delete armature**; child rows offer **Delete bone**. Create bones with the Bone tool. The inspector keeps **Bone setup / Pose / Weights**, numeric joint controls, and Reset pose.

Select artwork and choose **Assign bones**. Pick bones on the canvas or in Layers, then **Apply**. The inspector previews the result: no bones means unbound, one bone means rigid movement, and two or more means weighted deformation. Picking is temporary until Apply; Escape cancels. Native paths retain point bindings in both rigid and weighted modes. Nested groups and native clipping paths are included without changing draw order or hierarchy. Convert shapes and text to paths before assigning multiple bones: setup checks every descendant and either binds the complete scope in one undo step or explains why it cannot proceed. In artwork-first mode, selecting another artwork layer changes the weight scope immediately; selecting a bone keeps the current artwork scope.

Use **Edit bones** to change assignments without unbinding. New weighted bindings and rigid-to-weighted transitions initialize automatic weights; later edits to a weighted assignment preserve manual values, with added bones starting at 0%. Reducing to one bone gives every affected group 100% of that bone; conflicting locks must be unlocked first. Removing all bones unbinds the artwork while retaining its current appearance. Rigid bindings cannot be point-painted until another bone is assigned. Older single-bone bindings containing intentionally unweighted points remain **Custom weights** until assignments are explicitly edited.

Automatic assignment uses captured rest-space distances to the two nearest assigned bone segments; point bones use their position. Distances are inverse-square weighted, with exact joint ties split equally. Shared owners are evaluated once; independent handles use their own rest position. **Auto weights** previews selected groups, or the current scope when there is no selection. **Apply** commits once and **Cancel** keeps the existing weights. Locked influences retain their values.

Click an anchor or handle, Shift-click to toggle a group, or drag a selection box. Shift-drag adds groups. **Select all** and **Clear selection** affect only weight points; Ctrl/Cmd+A also selects weight points when their canvas controls have focus. Shared owners count once while every linked marker highlights. The point dropdown can select a specific handle for inspection. Color-coded influence rows offer a slider, percentage and **Lock**. Multiple selections show mixed percentages until you enter a common value. Slider and numeric edits preview point colors and values; completion applies deformation in one undo step. Escape or an interrupted gesture discards the draft. Unlocked influences share the remaining budget proportionally, or equally when they were all zero, so reducing 100% to 60% assigns the remaining 40% to other eligible bones. Use **Clear weights** to leave selected groups at rest; positive locked weights must be unlocked before clearing.

Exactly overlapping rest points share weights automatically when binding the scope. Their SVG points and contours remain separate. Use **Share overlaps** to join existing points in the current artwork scope; the first owner supplies the joined weights, so check differing values before joining. **Make separate** keeps the current values while splitting the selected point from a shared set. Shared links persist when posing, editing the rest setup or saving, and unlinking one path preserves surviving points' weights.

Handles inherit their anchor's weights by default. Selecting or painting an inherited handle edits that anchor's weight group. Enable **Independent handle weights** to copy its current inherited values into a separate control-point weight set; disable it to restore inheritance. Independent handles can have empty weights and stay at rest while their anchor moves. Different handle weights can change curve smoothness; the editor does not silently change tangent constraints or merge geometry.

The Weights workspace is ordered as you work: **Weights for** (the artwork or bone being edited, switched with **Artwork** / **Bone**), **Tool**, **Bones**, **Selection** and **Point** details. For painting, click a bone row to make it the active bone and choose **Add**, **Subtract**, **Set** or **Smooth** in the **Tool** bar (keys **1**–**5**; **1** is Select). The tool stays chosen as you move between artwork. A selection restricts painting to those weight groups; clear the selection to paint all eligible points in scope. Adjust screen-pixel **Size** and **Strength** with the sliders or **[** / **]** and **Shift+[** / **Shift+]**; Set also exposes a target **Value**. The brush ring is tinted by tool, and its dashed inner ring marks 50% falloff. A HUD at the bottom of the canvas shows the active bone, tool, settings and shortcuts. **Bones → Heat** colors every point by the active bone's weight from blue (0%) through green to red (100%); points the bone cannot influence turn grey. **Mix** shows each point's share of every bone. Smooth blends toward nearby points' selected-bone weights. Painting uses the same locked-budget normalization as numeric editing. Each stroke uses its strongest pass over a shared weight group once, so repeat strokes to build up a change. Point colors preview during the stroke; release applies artwork deformation in one undo step. Escape, pointer cancellation, focus loss, undo or a change of scope, selection, tool or view cancels the unfinished stroke. Space paints the focused point; Shift-click changes point selection without painting.

To paint from the other direction, choose a bone and switch **Weights for** to **Bone**. Choosing other artwork in Layers switches back to that artwork. This reverse view shows all points it controls across its eligible artwork. Uncheck **Only points this bone controls** to include zero-weight points on paths that already include the bone; use artwork **Edit bones** to add it to other paths first. Points at the same displayed position can still own different weights. Click their numbered marker to open a popover listing each independent weight group and its members, with a lock-aware percentage for the selected bone. **Add group** includes several groups in the selection without joining their weights. Alt-click opens the popover while painting. Shared weights stay one editable group; independent groups remain separately editable.

Use **Pose** to enter FK rotation, drag a tip to rotate, or drag roots and bodies to translate. Bound artwork follows live during the drag and commits on release. Arrow keys move point bones or rotate length bones (1 unit/degree, Shift 10). Enabled IK chains follow their targets after FK movement. Escape, pointer cancellation and focus loss discard a drag; one completed pose has one undo step. **Reset pose** clears authored rotations/translations; in Pose, enabled constraints still solve toward their reset targets. Use Reset pose in Edit for the unconstrained rest setup. Artwork selection handles are hidden while the Pose/Weights workspace is open. The eye button beside the workspace tabs shows or hides bones on the canvas.

Unbind retains the current artwork. Binding, attaching and drawing bones need the rest setup. In Pose, **Reset pose** keeps enabled IK reaching for its targets, so a leg can stay bent; **Reset to rest** clears the pose and pauses IK until you pose again. When an action is refused for this reason, the message offers **Reset to rest** and keeps any bones already picked. Edit can reposition a bound skeleton without moving artwork or changing weights. When editing a posed skeleton, its visible pose becomes the new rest setup and IK solving is suspended. Returning to Pose resumes constraints; use **Match target to tip** first if the control should follow the new setup. If bound artwork, transforms or topology are edited directly, posing stops with a diagnostic rather than overwriting the edits. Existing path/ancestor animation or motion-path constraints must be removed before initial binding. Project JSON retains editable rigs, weights and persistent IK targets; static SVG exports the current posed base artwork. Bone keyframes, rig actions and animated rig export are still planned.

**Rigid attachments:** assign one bone to a shape, text layer, or group containing non-path artwork to create a transform attachment. Native paths use point bindings instead, retaining shared owners and handle metadata. Both preserve SVG group membership, clipping, and draw order. A bone badge on the artwork row reveals the link; removing the assignment preserves the current pose. Ancestor/descendant rig links cannot overlap, preventing double transformation. Poses that would require an unsupported skew beneath a nonuniformly scaled parent are rejected atomically; use a uniformly scaled parent or bind native path points instead. Converting an existing transform attachment to multiple-bone native-path binding requires the rest pose and commits in one step. Project JSON document v14 / rig v5 stores canonical-owner locks without changing older weights on load.

### Persistent two-bone IK targets

Select the lower length bone of a connected pair (the shin or forearm) and click **Add IK…**. Valid targets highlight on the canvas: click the bone the chain should reach for, on the canvas or in Layers, or choose **New target at … tip**. Escape or **Cancel** leaves the rig unchanged. Any bone that neither rides on the chain nor carries it can be a target, including a length foot bone under the root; the chain reaches for the target's start. The lower joint must meet the upper tip before posing.

Keep foot controls under the armature root for planted feet. In **Pose**, moving Body bends the legs toward the stationary targets; moving the root moves the character and controls together. Parent a control under Body only when it should inherit Body movement. This relationship is independent of artwork layering.

Selecting either chain bone or its target opens the same named constraint. Rename it, change its target, enable/disable it, **Flip bend**, or **Match target to tip**. Setup changes in Edit preserve the visible artwork and suspend solving; Pose resumes reaching toward the target. Match in Edit moves the point into the rest setup at the current tip, avoiding an unintended jump when posing. **Remove constraint** retains the visible limb as an ordinary FK pose.

IK needs the lower bone to start exactly on the upper bone's tip. Drawing a bone near the selected bone's tip snaps it there, and dragging a connected bone's body in Bone setup moves the shared joint instead of separating it. If a joint has drifted, the IK panel names the problem and **Reconnect joint** (or **Snap to … tip** before IK exists) repairs it in one undo step; posing stays paused until then. **IK in this armature** lists every constraint as On, Off or Needs fix. In Pose, bones driven by an enabled constraint show dashed outlines; drag the target instead. **Quick IK** bends a chain once without saving a link. Drag the circular target in Pose to move the actual foot/hand point. Unreachable targets stay where you placed them while the chain clamps to its nearest reachable point; lengths never stretch. During a drag the skeleton and linked artwork preview the solve live; release commits it in one undo step. Escape, focus loss, pointer cancellation, selection/context changes and undo cancel unfinished gestures. Arrow keys nudge the target by one canvas unit, or ten with Shift. Targets, links, names, bend settings and setup suspension survive save/reload. Current saves use rig schema v4 in document v13; older poses, target links and inherited handles remain compatible.

For a quick unlinked pose, select a connected lower bone, choose **Pose → Quick IK**, and drag the square endpoint handle. This shortcut stores the resulting FK pose; use **Add IK…** for a persistent control. Rig poses are currently static: they do not yet provide bone/control keyframes or reusable rig actions.
