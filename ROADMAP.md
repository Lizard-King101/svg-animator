# Product Roadmap

SVG Animator is a browser-based motion SVG studio. The overhaul prioritizes making artwork easy to arrange, shapes easy to construct, and animation easy to understand and refine. Features are grouped by shared mechanics so each improvement supports the next.

The October 24, 2026 scene-composition direction adds reusable actions, animated actors, and scene sequencing alongside direct property animation. Motion graphics, character/prop animation, and scene animation share the same editable SVG artwork, keyframe tools, evaluation semantics, and publishing pipeline. Scene authoring is optional; existing projects and direct animation remain first-class workflows.

This is the source of truth for planned work and delivery order. [FEATURES.md](FEATURES.md) records shipped behavior, [ARCHITECTURE.md](ARCHITECTURE.md) defines ownership, and [SVG_COMPATIBILITY.md](SVG_COMPATIBILITY.md) tracks SVG coverage. Novelty modes and the earlier silly-feature category are excluded. Useful techniques such as springs, squash/stretch, stagger, and follow constraints remain ordinary animation tools.

## Selected-key retiming — October 26, 2026

- **Retime keys** stretches/compresses a selected range around Start, Center, End or Playhead, or reverses the range. Percentage/anchor fields are staged; Enter/Apply commits once and Escape/Cancel discards. Selection/context/revision changes invalidate drafts.
- Pure planning validates all channels before writes: continuous blocks, at least two distinct selected times, 0.01s grid, no collisions or crossing unselected keys. Linked boundaries and edits breaking matched seam speeds require unlinking. Duration/work area remain unchanged; source keys may extend beyond them.
- Speed handles scale with segment duration. Reverse swaps and negates handles and transfers inverted easing to the correct segment. Exterior transitions stay attached to range edges; differing linked handle speeds unlink. Holds and discrete values remain stepped in reversed key order.
- Action placement stretching remains the next retiming slice; whole-cycle retiming and rotation winding links remain separate follow-ups.
- Validation: 89 focused retiming, component, timeline, loop, rig and action tests pass, plus production build and diff checks. Browser checks covered Enter/Apply, Escape cancellation, one-step undo/redo, reverse, save/reopen, wrapping controls and the resulting signed speed in Graph view.

## Pose blocking — October 26, 2026

- The Pose panel distinguishes **Key selected control** from **Key armature pose**, shows the receiving scene/action and time, and makes whole-armature commands available even with an IK-driven bone selected.
- Whole-armature keying captures rotation and both offsets for authored FK and target controls. Enabled IK-driven bones remain excluded; pose validation and channel-conflict checks run before writes. A command commits once through the existing animation mutation boundary.
- **Copy armature pose / Paste armature pose** captures the current sampled control values and keys them at another time or in an action scoped to the same rig. Stable bone IDs and rest/IK structure validation prevent silent retargeting or partial paste. Clipboard data is session-only, independent of subsequent pose edits and history replacement. Saved files and exports continue to use ordinary keys.
- Named control sets, named/mirrored pose libraries and keyed-field indicators remain follow-ups. Retiming is the next planned feature slice.
- Validation: 102 focused rig authoring, timeline, inspector, action and editor integration checks pass, plus production build and diff checks. Browser checks covered whole-pose keying, copy/paste, save/reopen, one-step undo/redo and keyboard access to the command group.

## Timeline navigation and visibility — October 26, 2026

- Search object, rig, bone and channel names, with combinable Selected only and Animated only filters. Matches inside collapsed branches retain their hierarchy; clearing filters restores the user's previous expansion state. Selection includes group descendants or the selected bone branch. Reveal selection clears filters, expands the branch and scrolls it below the ruler.
- Fit keys frames the selected key range (including a single key); Fit work area frames the preview range. Fit duration also resets stale horizontal scroll. These commands work in both timeline and graph views.
- Previous/Next pose buttons and Alt+Left/Right navigate selected key channels first, then selected artwork/bone branches, otherwise the active scene/action. Editable fields retain their keyboard behavior. Navigation pauses playback and stays within playable document time.
- Preview speeds of 0.25×, 0.5×, 1×, 1.5× and 2× are exposed. Filters, navigation and speed do not alter saved animation or export timing. Changing filters clears key selection; keys hidden by a later selection-scope change cannot be deleted through the timeline selection commands.
- Validation: 62 focused navigation, filtering, rig, loop-control and playback tests pass, along with production build and diff checks. Browser checks covered search, filtering, reveal positioning, key/work-area fitting, pose stepping, preview speed and wrapped graph-toolbar layout. Pose blocking is next; authored retiming and ping-pong remain separate work.

## Speed-graph reliability and linked loops — October 26, 2026

- Repaired graph selection/no-op/cancellation rollback, stale numeric targets after property/history changes, Alt-unlink, pointer interruption, Hold speed rendering and domain-dependent curve caching. Numeric Speed/Influence commit on blur/Enter and cancel with Escape. Seeking/playing preserves the graph selection; true context changes clear it. Playhead dragging survives its own seek notifications, pauses playback, and releases cleanly on interruption. The graph fits its actual available pane height as toolbar rows wrap.
- **Loop seam** links existing animated channels at work-area boundaries in the active scene or action. Select keys/graph channels or selected artwork/rig, choose the starting or ending pose as authority, then Link endpoints. Missing boundary keys are sampled/created; interior keys remain. Property, canvas and rig edits synchronize either endpoint with one undo step. An optional speed link matches the start's outgoing and end's incoming speed, retaining independent influences; Hold remains a deliberate discontinuity.
- Linked rows show their range and speed state. Unlink preserves current motion. Boundary retiming and shortening the duration past a linked end are protected with an explanation; moving/resizing a whole linked cycle and rotation winding offsets remain follow-ups. Links concern already animated channels, not an implicit whole-rig snapshot or a new actor/pose library.
- **Loop ghosts** adds wrapped canvas onion skins and a dashed speed-graph continuation across the work-area edges. Past/future tint uses displayed time across the seam. Ghosts are session-only, noninteractive and absent from exported animation. A placement whose trims differ from its source's linked range shows a warning; its source and finite-end behavior remain unchanged.
- Document v18 stores authoring links on tracks; old files retain their motion. Action/source and artwork duplication remap link references, while removing a boundary key removes the link. Publishing uses ordinary synchronized keys and the existing runtime, including repeated action parity.
- Validation: 153 focused and adjacent ChromeHeadless checks pass, plus production build, runtime API/fixture checks and `git diff --check`. Browser checks covered linked endpoint edits, reload persistence, seam-speed dragging, numeric Escape, wrapped previews and ruler dragging in both timeline and graph views. The full suite remains the final overhaul/release gate.

## Animation workflow review — October 26, 2026

This source/UI audit reconciles the earlier plan with the delivered rigging work. The items below are proposals, not newly shipped features. Historical implementation gates further down describe their original milestones; this checkpoint and the completed slices take precedence when assessing remaining work.

### Already delivered

- Direct artwork and bone/control animation share key selection, marquee, copy/paste, relative-time moves, nudging, numeric values, easing and the speed graph. Property rows already have previous/next-key buttons.
- Onion skins, selected-artwork origin trails, draggable playback work areas, timeline pan/zoom and duration fitting are available.
- Reusable action sources have local-time editing, explicit target scope and linked scene placements. Blocks already support moving, pointer trimming, numeric rate, finite loops and overlap diagnostics. Trimming the source interval is distinct from stretching the block's playback duration.
- FK and persistent two-bone IK controls can be keyed, reused in rig actions and published through the shared runtime evaluator. Animate-mode pose edits create keys automatically; **Key selected control** records one control; **Key armature pose** records all authored controls.

### Remaining work from the previous plan

| Mechanic area | Genuine remaining work | Existing foundation / boundary |
|---|---|---|
| Keyframe timing | Stretch/compress and reverse a selected key range | Moving/offsetting selected keys is already supported; temporal handles must retain the intended motion under scaling/reversal |
| Playback and loops | Ping-pong preview, explicit seam comparison and whole-cycle retiming | Preview-speed controls, endpoint links, wrapped ghosts, ordinary looping and work-area playback are shipped |
| Timeline precision | Optional frames/FPS display, frame stepping and frame snapping; editable markers | Seconds remain the underlying time model; `fpsHint` and marker storage exist without a complete authoring UI |
| Graph editing | Value graph alongside the speed graph | Reuse numeric channels, selection and temporal interpolation rather than introducing separate animation data |
| Action timing | Pointer stretch handles, authored reverse/ping-pong placements, composition-aware trim-to-work-area | Positive rates, finite repeats and pointer source trims are shipped; authored timing changes require editor/runtime parity |
| Animated drawing | Trim-path start/end/offset, keyed outline/taper controls, assisted morph correspondence | Draw Progress and static outline editing exist; topology and bound-path protections must remain explicit |
| Motion recipes | Presets, stagger, spring/settling, squash/stretch and reversible baking | Generate editable existing tracks/actions before considering new procedural evaluators |
| Reuse and advanced rigs | Actor instances/binding remaps, pose blending, broader constraints and keyed constraint settings | Actions currently address the original targets; independent actor instances and cross-rig reuse remain separate scope |

### Additional workflow improvements worth prioritizing

| Feature set | Proposed additions | Why it helps |
|---|---|---|
| Find the controls | Delivered in the navigation/visibility slice above | Search, filters, reveal and fit commands reduce unrelated channel clutter |
| Block poses | Initial whole-armature keying and pose copy/paste delivered; explicit named control sets remain | Establish anticipation, contact and recovery poses without repeatedly opening every bone's channels |
| Read keying state | Visible Animate-mode keying/context feedback and keyed-at-playhead indicators in Pose fields | Make it obvious which scene/action receives the edit and whether a value has a key here |
| Navigate time | Delivered in the navigation/visibility slice above | Scoped previous/next pose navigation supplements existing per-row buttons |
| Refine holds and cycles | Discoverable hold/step timing, linked loop endpoints, optional seam-speed matching, wrapped ghost previews | Keep boundary poses synchronized while editing and inspect continuity across the repeated cycle |
| Sequence actions | Multi-select/move/duplicate placements, an explicit hold-last-pose option, and clearer source-versus-placement feedback | Arrange several coordinated actions and avoid surprising returns to base/scene motion at a block's end |
| Reuse poses | Named pose snapshots, then mirrored poses using explicit left/right control mappings | Reuse expressions and contact poses without pretending names alone are a safe retargeting contract |

### Recommended next slices

0. **Delivered:** speed-graph reliability and the initial linked-loop/ghost workflow; see the completed slice above.
1. **Delivered:** timeline navigation and visibility; see the completed slice above.
2. **Delivered:** selected-control/whole-armature keying and same-rig pose copy/paste. Named control sets remain a follow-up; see the completed slice above.
3. **Retiming (selected-key scale/reverse delivered):** next stretch action placements through placement rate, with edge anchors, rate limits, collision checks and pointer/keyboard cancellation. Scaling source keys and changing placement rate remain distinct commands.
4. **Loop refinement and precision:** whole-cycle move/resize, rotation winding offsets, preview ping-pong, seam comparison, frame controls and markers. Initial endpoint links and wrapped ghosts are delivered. Separate preview-only direction from authored reverse/ping-pong placements, which need versioned runtime semantics. Composition-aware range trimming belongs with this timing work.
5. **Expressive tools:** value graph, editable motion recipes/stagger, then animated outline controls. Schedule actor instances and pose blending as larger projects after these everyday workflows are comfortable.

Use focused interaction tests and adjacent animation/rig/context/export tests for each slice, with a production build and diff check at handoff. Run the full suite at the final overhaul/release check. This review changes the plan only; it does not claim new runtime or browser verification.

### Linked loop endpoints and wrapped ghosts — requested October 26, 2026

Add an explicit **Link loop endpoints** command for action sources and direct animation. The first delivery links compatible boundary keys within a chosen cycle, with a visible link badge and an **Unlink** command. Equal values alone must never create a link automatically. The initial value/speed links and wrapped previews are delivered above; whole-cycle move/resize remains planned.

- **Edit either end:** synchronize the value of each linked start/end pair when editing a property, moving artwork or posing a rig at either boundary. Both keys remain one cycle apart in time; they represent one boundary pose. Apply through the existing animation mutation boundary so preview, cancellation and one-step undo include both ends. Whole-pose linking groups compatible channel pairs, excluding IK-driven channels and unsupported topology changes.
- **Establish the seam deliberately:** if boundary keys are missing or values differ, show which selected endpoint supplies the shared value and which keys will be created/updated. Preserve interior keys. Existing animations remain unchanged until linking is applied.
- **Distinguish pose movement from retiming:** canvas movement synchronizes keyed values. Boundary time edits must keep the pair attached to the declared loop range, rather than collapse both keys onto one timestamp. Provide deliberate cycle move/resize behavior with endpoint keys following its boundaries; handle collisions atomically. Retiming one boundary away from the range requires an explicit unlink or range adjustment. Changing a preview work area alone must not silently rewrite authored keys.
- **Optional smooth seam:** equal values prevent a positional jump but can still produce a velocity jump. For numeric channels, optionally link the end key's incoming speed to the start key's outgoing speed. Preserve their independent influences and account for adjacent segment durations. Allow a deliberate stop/corner; do not force smoothness on Hold/discrete channels. Rotation winding such as 0° to 360° needs separate offset-aware semantics and must not be silently flattened by an equality link.
- **Ghost the neighboring cycle:** show a faint, noninteractive continuation of graph curves/key markers just beyond the cycle end (and before its start). Wrapped canvas onion skins show the next cycle's opening poses while inspecting the end, and the previous cycle's closing poses while inspecting the start. Mark the seam and keep past/future tint based on the displayed cycle offset, not the wrapped source time. Reuse detached inspection sampling; ghosts create no keys, add no duration and do not appear in exports.
- **Respect action scope:** a source link affects all linked placements through their existing source. Placement trims may introduce a different seam, so show a mismatch diagnostic/preview instead of rewriting the shared source automatically. A finite placement still returns to underlying scene/base values at its final end; this feature smooths cycle repeats and does not imply hold-last-pose or blending.
- **Persistence and validation:** store explicit stable key/channel references with the loop range through a compatible document migration. Ordinary synchronized endpoint keys retain current runtime evaluation; authoring links and ghosts do not require a separate playback engine. Define link behavior for key deletion, duplication, paste, action extraction, duration changes and unlinking. Verify bidirectional edits, keyboard/pointer cancellation, undo/reload, uniform scale, rig controls and exact/random/backward seeks at cycle boundaries, plus editor/export parity.

Deliver value/pose links first, then seam-speed linking and wrapped graph/canvas inspection using the repaired handle lifecycle. Frame-based timing remains optional and is not a dependency.

### Speed-graph investigation — October 26, 2026

Historical audit (the reported defects are repaired in the delivery above): nine temporary diagnostic probes reproduced the following defects through `TimelineEditorService` in ChromeHeadless. The probes asserted the observed faulty behavior; their passing results do **not** mean the defects are fixed. All 43 existing tests in the selected timeline editing, timeline editor, rig timeline and animation-model specs also passed (52 checks total). This was a service/event and evaluation audit, not a manual browser interaction or performance review. No production code was changed.

| Priority | Confirmed issue and reproduction | Repair boundary |
|---|---|---|
| High | **Selection/cancellation changes motion.** On a preset-only ease-in segment, click its outgoing handle without dragging, or drag and press Escape. The neighboring key retains a newly initialized incoming tangent, changing the evaluated motion without an animation commit. These are two reproduced paths. | `initializeGraphHandle` writes both segment endpoints, while snapshots restore only selected keys. Snapshot every affected key, including linked neighbors and uniform-scale partners; selection/no-op/cancel must preserve the complete starting animation. |
| High | **Editing can target an old curve.** Select a handle, switch the displayed property to an unrelated channel, then type Speed. The hidden previous curve changes. After history replaces the tracks, the same field edits a detached old key instead of the restored animation. These are two reproduced paths. | Resolve active handles by stable IDs against the current context, clear or deliberately remap them on selection/history changes, and reject stale edits. Cover deletion, context changes and interrupted gestures too. |
| High | **Interrupted gestures do not reliably cancel.** A `pointercancel` after movement emits an animation commit; window blur leaves the graph drag active. These are two reproduced paths. | Graph gestures currently use the shared pointer helper's completion handler for pointer cancellation and supply no blur callback. Separate completion from cancellation without regressing numeric fields, work-area controls or key drags. |
| Medium | **Alt/Option unlink does not survive dragging.** At an interior linked key, Alt-drag initially sets `linked=false`, but the first update restores the original linked state and moves the opposite tangent as well. | Preserve the gesture's unlink intent when rebuilding each preview from its original snapshot. Test both incoming/outgoing sides and multi-selection. |
| Medium | **Hold speed disagrees with playback.** Apply Hold to a segment with differing endpoint values: evaluated values stay constant inside the segment, but its graph reports positive speed. | `segmentSpeed` evaluates temporal handles before checking Hold, while value evaluation checks Hold first. Render the held interval consistently and treat the endpoint jump explicitly. |
| Medium | **Cached curves can detach from their handles.** Render a curve, then introduce a negative-time key on another track. The timeline domain shifts and the root positions move, but the cached curve retains its old X coordinates. | Include the time-domain origin in the speed-path cache key or invalidate it when the domain changes. Cover retiming, paste and history. |

Implementation should turn these reproductions into permanent tests asserting the corrected behavior. Additional browser checks should verify live redraw during handle drags, paired/uniform-scale channels, numeric input undo/cancellation, keyboard access and long-track responsiveness; these remain checks to perform, not confirmed defects from this audit.

## Visible clipping artwork — October 25, 2026

- Reused the clipping layer's normal eye toggle: new clip sources start hidden, and showing the source paints its fill behind clipped details and its outline above them. Clipping geometry stays active in both states; surrounding clips still apply. Geometry, rig weights and outline sections remain on one source.
- Replacement, release and ungroup reveal the former source. Visibility changes preserve clipping, transform origins, rig eligibility and independent descendants' visibility, and commit once through the existing layer commands.
- Envelope v17 preserves older hidden clipping artwork, including scene and action visibility channels, while retaining track/key IDs and action scopes. Runtime 1.5's `render.visible-clipping-v1` capability carries the new visibility semantics; legacy bundles retain their established behavior.
- Verification: 239 focused clipping, rendering, migration, rigging, selection, animation and export tests passed, plus the production build, runtime API/fixture/size checks and diff check. Browser verification covered hidden/visible eye artwork, a tapered upper eyelash, undo and save/reopen.

## Rig-friendly outlines and path editing — October 25, 2026

- Delivered one source path for fill, geometry and rig weights, with authored visible outline sections. Stroke's Edit outline workspace has separate section/segment selection, Hide/Show, continuous curve-local endpoint markers, independent smooth start/end taper controls and Restore full outline. Drafts stay outside persistence; completed gestures commit once.
- Reliable in-place single/multiple duplication copies complete appearance, rig links, independent weights/locks, clipping, scene/source-action channels and action scopes. Internal shared owners are remapped; external owners are materialized. Armatures, action sources and placements remain shared.
- True Break/Open/Close preserve curves and independently editable coincident endpoints on unbound paths. Bound or geometry-animated paths are protected, including destructive Trim and incompatible conversion/boolean operations. Segment insertion remaps outline references; unsupported topology changes explain how to proceed.
- Envelope v16 preserves old inferred closure while new explicit-open contours stay open. Runtime 1.4's `render.outline-sections-v1` supports derived outlines and explicit closure. One pure projection follows deformation and supplies editor, onion skins, static export and runtime output. Legacy paths without outline metadata keep their established Draw Progress behavior.
- Verification: 313 focused tests passed across outline interactions, geometry, duplication, rigging, animation and export. The production build, runtime API check, regenerated fixture checks, runtime size check and `git diff --check` passed.
- Follow-up: animated trim/taper controls and weight-preserving cuts on bound artwork. Per-section colors and stacked strokes remain outside this scope.

## Delivery order

Each stage ships as focused, reviewable changes. Stages are a sequence, not a promise to implement every item in one pass.

| Stage | Scope | Outcome |
|---|---|---|
| Foundation | Handle visibility and interaction polish; preserve the existing workspace overlay | Controls are understandable and reliable around the artboard |
| A Comfortable creation | Project restore, recoverable deletion, canvas multi-selection, clipboard, basic alignment and snapping | Build and arrange a scene with less friction |
| B Precision drawing | Path snapping, edge rotation, tangent/perpendicular snapping, reference tracing, region building and trimming | Construct clean artwork from simple geometry |
| B2 Color tools | Active fill/stroke colors, unified project color palette, artwork/reference eyedropper | Color complex artwork consistently and reuse colors quickly |
| C Motion refinement | Onion skins, motion trails, keyframe retiming, ping-pong, loop inspection | See and correct timing and motion |
| C1 Reusable actions | Named action sources, explicit target scope, focused local-time editing | Author a blink, door movement, or graphic transition once |
| C2 Scene sequencing | Linked action blocks, independent placement, deterministic overlap and time rules | Choreograph actions while retaining precise property editing |
| C3 Character rigging | Bone creation, rest/bind setup, per-point weights, FK/IK posing and pose animation | Build, bind, pose and animate editable vector characters |
| D Animation tools | Presets, stagger, springs, squash/stretch, deterministic variations, bake | Create appealing motion quickly and retain editability |
| E Reusable resources and actors | Linked styles, repeaters, symbols, animated actor instances with their rigs/actions, shared libraries | Reuse artwork and actions with independent instance timing and poses |

Appearance and publishing improvements accompany the stage that needs them. Project safety and accessibility are ongoing requirements throughout the sequence. Larger expansions remain in the deferred section below.

**C3 rig animation foundation is implemented:** bone/control channels, reusable armature actions, deterministic seeking and shared animated rig export extend persistent target IK and the unified binding/weights workflow. Shared timeline scrolling, source trims, positive rates and finite loop counts also apply to rig actions. The next planning boundary is richer animation controls and reusable actor instances; pointer stretch handles, reverse/ping-pong playback, pose blending and broader constraints remain planned. Physics still requires a separate deterministic seek/export design.

The C1/C2 action-composition foundation is implemented; completing every C follow-up is not a prerequisite for rigging. D presets should reuse action storage where appropriate, and E actor reuse should extend the same resource/binding model. Precision-drawing follow-ups remain on the backlog. The completed slices define shipped behavior; the broader integration design below includes planned extensions.

Character rigging is a required C3 workflow, including bones, point binding/weights, and FK/IK posing. It can first operate on existing document artwork without waiting for E's linked actor library. The earlier action-only milestone proves composition; it does not constitute delivery of character rigging.

## Completed implementation slices

### Bone/control keyframes and reusable rig actions — October 25, 2026

- Animate mode uses Pose for rig editing. FK rotations and parent-local X/Y offsets, including persistent foot/hand controls, are editable from the canvas, Pose fields and armature/bone timeline rows. Existing key selection, retiming and speed-graph tools apply. Enabled IK chain bones are driven by their target instead of competing keyed rotations/translations.
- Completed pose gestures key all changed authored controls in one document mutation. Live skeleton and linked artwork previews cancel with Escape, focus/pointer loss, history or context changes. Keys preserve the authored rest/bind setup and weights; solver output never becomes persistent FK keys for a linked IK chain.
- Armature action scope can start an empty source or extract the selected rig's scene keys. Sources retain editable bone channels; scene placements share trim, rate, repeat, overlap and direct/base fallback rules with artwork actions. Sources target the original rig by stable IDs; actor instances, bone remapping and cross-document libraries are separate work.
- Evaluation samples scene/action control values, computes FK, solves enabled two-bone IK and then updates weighted paths and rigid attachments. Random/backward seeks use the same inputs; detached inspection restores stable-ID baselines and includes controlled artwork in onion skins. Animation solves enabled IK without changing an Edit setup's saved suspension state.
- Document v15 keeps animation schema v2 and rig schema v5, with an identity migration from v14. Runtime 1.3 adds `rig.pose-v1` and optional rig data to bundle v1. Editor and player use the same framework-free rig kernel, preserving interpolation and action windows without frame baking. Animated publishing validates rig references, topology and conflicting writers. Static SVG remains the authored base artwork.
- Geometry, point, transform and motion-path channels on controlled artwork/ancestors cannot run alongside an animated rig; style, opacity and visibility remain compatible. Bone scaling, keyed constraint settings, pose blending, IK stretch, cross-rig constraints, physics and actor retargeting remain outside this slice.

### Simpler binding, automatic weights and direct multi-point editing — October 24, 2026

- One Assign bones / Edit bones flow previews zero bones as unbound, one as rigid, and multiple as weighted. Native paths keep point bindings in all modes; other artwork retains transform attachments. Converting an existing transform attachment to weighted paths requires rest setup and commits atomically. Shapes/text conversion stays explicit, and grouping, clipping and draw order remain unchanged.
- New weighted bindings and rigid-to-weighted transitions initialize nearest-two-bone rest-space weights. Existing weighted assignments preserve manual values; added influences start at zero. Auto weights previews the selected owners or current scope, honors locks, and applies or cancels explicitly.
- Click, Shift-click and marquee selection count canonical owners once. Influence sliders and percentages show mixed values, preview colors without writing geometry, and commit once. Locked influences retain exact values; remaining weights redistribute proportionally or equally when initially zero. Clear weights explicitly leaves groups at rest.
- Artwork-first scope follows artwork-layer selection while bone selection retains that scope. Bone-first reverse painting uses the same selection, locks and editing rules. A selection limits brush changes; overlapping independent groups can be added from the popover without merging them. Rigid artwork cannot be painted until a second bone is assigned.
- Document v14 / rig schema v5 adds canonical-owner influence locks. Legacy single-bone weights, including unweighted points, remain explicitly custom rather than becoming rigid on load. Shared owner splitting/rehoming retains values and locks.
- Verified 211 focused rigging and adjacent editor tests, plus a 55-test rerun after final shared-helper and label refinements. Production build and whitespace checks pass. Browser checks covered rigid-to-weighted assignment, automatic preview/cancel, mixed multi-point editing, locks, selection-limited painting, marquee and overlap selection, scope changes, undo and saved-project reopening.

### Group binding, shared weights and reverse weight painting — October 24, 2026

- Weighted artwork scope includes native paths in nested groups and native clipping paths. Setup preflights the complete scope and commits once; shapes/text need conversion, and unavailable or already linked descendants reject the operation without a partial binding. Artwork hierarchy, draw order and clipping stay intact.
- Exactly coincident captured rest positions share explicit weight ownership across transformed paths. Geometry IDs and contours remain independent. The explicit sharing command uses the first owner's weights; Make separate copies effective weights, and removing an owner path rehomes surviving members.
- Bézier handles inherit by default and can opt into independent weights. Independent empty weights mean rest geometry; restoring inheritance preserves other members of any shared set. Numeric editing resolves each canonical owner once and normalizes influences.
- Add/Subtract/Set/Smooth painting provides radius, strength, a Set value, temporary point-color previews and one completed-stroke commit. Shared and inherited-handle hits update one owner; repeated events do not compound a stroke. Escape, pointer/focus loss, history and context/view changes cancel drafts; Space paints a focused point.
- Bone-first reverse weights shows controlled points across the selected bone's artwork, with an optional zero-weight view. Overlapping independent weight sets open a popover for member selection and selected-bone percentages; Alt-click inspects overlaps while painting. The popover never merges their geometry or weights implicitly.
- Document v13 / rig schema v4 introduced group scopes, weight-source links and handle overrides. Legacy files retain poses, IK links, separate weights and anchor inheritance. Locks and automatic weighting followed in the slice above; rig animation/actions and animated rig export followed in the October 25 slice above. Final verification results are recorded at handoff.

### Persistent IK targets and Binding & weights sidebar — October 24, 2026

- Verified 121 focused/adjacent tests covering rig evaluation, commands, gestures, sidebar, migration, properties, actions, colors and exports. Production build and diff checks passed. Browser checks covered planted targets, target movement, saved links after reload, influence editing, normalization, pinned artwork and matching bone/point colors.

- Named two-bone constraints link connected upper/lower bones to existing or newly created point targets. Root-parented feet remain planted while Body moves; root movement carries the character and targets together. The same inspector is available from either chain bone or target, with enabled state, bend flip, target changes, match-to-tip and removal.
- One deterministic evaluator applies authored FK, then constraints, then materialized weighted geometry and rigid transforms. Invalid references, descendant targets, duplicate writers and dependency cycles are rejected. Reach clamps without stretching; target points keep their requested positions.
- Edit setup changes preserve artwork and suspend solving; Pose resumes it. Match target to tip supports deliberate setup alignment. Reset in Edit clears authored offsets with solving suspended; Reset in Pose evaluates enabled constraints after resetting offsets. Constraint removal preserves the visible limb as FK.
- Document v12 / rig schema v3 saves target links, named settings and setup suspension; legacy files preserve their existing poses without inferred constraints. Bone/control keyframes and animated rig evaluation followed in the October 25 slice above.
- The dedicated Binding & weights sidebar pins one native path while bones are selected, distinguishes rigid and weighted links, and edits influence sets without unbinding. Added bones start at zero; removed influences normalize remaining values. Stable colors connect the legend, bound bones, anchors and handles, with all handles visible and inheriting anchor weights.
- This slice delivered steps 1 and 2 below. Group weighted binding, coincident-point weight sharing, independent handles and painting followed in the slice above. Final verification results were recorded separately at handoff.

### Bone tool, layer integration and artwork-first linking — October 24, 2026

- Diamond bone drawing and circle-crosshair point bones; automatic chain parenting and named point roots for new armatures.
- Bone hierarchy in the existing Layers panel; artwork rows retain draw order and expose relationship badges.
- Rigid layer/group attachments and cancellable artwork-first multi-bone point binding, initialized with equal weights.
- v11 persistence, atomic pose/attachment changes, detach preserving transforms and guards against double transformation or unsupported skew. Persistent IK and keyed rig actions followed in the later slices above.


### Armature creation, static FK and manual weights — October 24, 2026

- Multiple named rigs; parent-local rest joints, bone parenting and child/root creation. Separate rest and pose controls; numeric, pointer and keyboard FK rotation.
- Native path binding with stable anchor IDs, manual normalized weights, influence visualization and inherited handle weights. Zero-weight points stay at rest; unbind retains current artwork.
- Canvas-space linear deformation supports nested/reflected/nonuniform transforms and fixed pivots. Stale geometry/topology/transform bindings block posing rather than overwrite edits.
- Document v10 stores rigs, rest geometry and weights; pose plus geometry commit together through history/autosave. Static exports reproduce the current pose.
- Subsequent slices added non-stretching two-bone IK, persistent targets, painting, automatic weighting, keyed bone/control channels in actions and deterministic animation/runtime export parity. Broader rest-edit/rebind ergonomics remain a follow-up.


### Shared scene timeline and placement timing — October 24, 2026

- Placement rows share the dope-sheet ruler, zoom, horizontal/vertical scrolling and playhead. Sticky labels retain source/start controls plus In, Out, Rate and Loops. Explicit grid row sizing preserves controls; layer virtualization subtracts the placement header region.
- Non-destructive source-local trims, positive rates (0.01–100×), and finite whole repeat counts (1–10000) determine scene length. Repeat copies those settings into a separate adjacent placement. Source keys remain unchanged; field blur/Enter commits once, Escape cancels, and invalid timings or conflicts restore the field.
- Preview, onion sampling and portable runtime reuse the same local-time mapping. Loops restart at In; each source interval and the final scene end are exclusive. Boundary comparisons use the compiler's 12-decimal animation precision to avoid floating-point disagreement. Temporal curves, paths, gradients, transforms and random/backward seeks retain editor/runtime parity.
- Document envelope v9 preserves optional timing fields and migrates v8 without changing older motion. Runtime 1.2 declares composition.action-timing-v1, so older players reject timing they cannot interpret rather than silently rendering incorrectly.
- Verified 92 focused/adjacent timing, input, timeline, migration, inspection and runtime tests, plus production build, runtime API/size checks and browser checks for scrolling, zoom, field validation and one-step undo.
- Draggable trim handles now use the existing move gesture lifecycle, snapping and mutation boundary. Opposite scene edges stay fixed; source bounds and a nonempty interval clamp trims. Keyboard nudges, Escape/blur/pointer cancellation, no-op completion and compound start/trim undo are covered. The trim follow-up passed 49 focused/adjacent tests, production build and browser checks.
- Remaining: pointer stretch handles, reverse/ping-pong, blending and actor binding remaps. Character rigging followed in the later slices above.


### Action editing contexts and reusable placements — October 24, 2026

- Named sources capture an explicit selection/descendant scope. Create a blank source, extract selected scene motion, rename, duplicate independently, or remove a source and its placements atomically. Action-local editing reuses the timeline/graph, canvas gesture keys, paint keys, playback and inspection. Scene/source playheads are session state; the selected SVG stays stable.
- Scene placements link to sources. Place at the playhead, edit a numeric start, repeat a linked block, remove it, or open its source. Placement rows now share the detailed timeline ruler and viewport. Blocks support dragging with edge/playhead snapping, Alt bypass, cancellation, and keyboard nudges.
- Full source duration plays at rate 1 on [start, end). Only authored action channels replace scene values; direct tracks or base artwork resume immediately at the end, including the scene endpoint. No blending or endpoint hold is implied. Distinct actions may overlap on shared artwork when their enabled channels do not conflict. Frame geometry and point deformation share an exclusive domain; repeated placements of the same source remain exclusive. Conflicting placement/duration edits are rejected, and a mutation-boundary guard restores the last committed animation if later source editing, paste or track restoration would introduce a conflict.
- Project envelope v8 adds optional version-1 composition to animation schema v2. Legacy files retain their tracks; Project JSON keeps editable sources/links. Runtime 1.1 adds the explicit `composition.action-windows-v1` capability to bundle format v1, retaining exact interpolation and base/direct fallback. Older runtimes reject this capability. Static SVG remains base artwork; animated publishing always exports the scene.
- Source/placement edits use the mutation boundary, including undo/redo and palette discovery; orphan repair includes source tracks. Timeline drafts and key selection cancel/clear when switching contexts. Browser checks covered source creation, canvas keying, two linked placements, source propagation, overlap feedback, placement undo/redo and reopening.
- Verification: 135 focused/adjacent tests, production build, runtime API report and runtime size check passed; browser checks included keyboard draft cancellation, block nudges and exact edge snapping.
- Remaining: pointer stretch handles, binding remaps/actor instances, blending and nested scenes. Trim-to-work-area remains available only for direct animation until its composition semantics are implemented.

### Onion skins and origin motion trails — October 24, 2026

- Animate mode has independent Onion skins and Motion trails toggles plus onion spacing in seconds. Skins show up to two earlier and two later poses, tinted teal/amber, bounded by document duration without wrapping. They follow selected artwork; with no selection they show animated artwork, retaining ancestor context and omitting unrelated static backgrounds.
- Trails trace evaluated transform origins for up to eight selected objects across the full duration, with 60 sampling intervals, time ticks and a current-time marker. Nested transforms, custom origins, point deformation and motion-path attachments use existing geometry/evaluation helpers. Invisible intervals break the trail; crowded labels are suppressed. Trails are sampled guides, not editable motion paths or per-anchor trajectories.
- A detached document snapshot owns sampling. Each sample restores its geometry baseline, so backward/random sampling does not accumulate geometry edits. Live artwork, preview state, active gestures, selection, history and exports are untouched. Ghost SVG images isolate IDs/gradient/clip definitions from the live DOM. Samples are cached by document/revision/selection; pan/zoom only reproject the overlay.
- Controls are session-only. The passive workspace overlay is below editing handles, disappears in Edit mode and during playback, and returns when paused. No schema migration, reference-image export, or runtime change is required. External font/resource rendering in isolated SVG images retains normal browser image limitations.
- Verified 65 focused/adjacent inspection, timeline, path interaction, editor and runtime-origin tests; browser checks covered both previews, keyboard toggles, selected group context, zoom, playback hiding and Edit-mode cleanup. Production build and diff checks passed.

### Shared artwork/reference eyedropper — October 23, 2026

- Every shared color editor exposes one eyedropper for drawing defaults, paints, text, gradient stops, and timeline colors. Artwork samples the rendered canvas; Reference samples original image pixels independently of tracing opacity and overlapping artwork, including locked references.
- Added a magnified preview, color value, source switch, click/Enter selection, arrow-key movement, focus trapping/return, and Escape cancellation. Sampling respects placement, zoom/pan, nonzero viewBox, letterboxing, and alpha; transparent or out-of-bounds samples do not apply.
- Sampling pauses playback and cancels on context changes or owner destruction. Confirmed picks route through existing color owners and flush their coalesced edit immediately for one-step undo; previews and canceled drafts do not collect palette colors. No document migration or browser-specific screen picker required.
- Verified 66 focused sampling and adjacent paint/palette/reference/timeline tests, plus browser source switching, keyboard and pointer selection, cancellation, focus return, palette reuse, and immediate undo/redo. Production build and diff checks passed. Artwork raster resolution is capped at 4096 pixels per side; references retain original source pixels.

### Unified Project colors — October 23, 2026

- One project-owned palette combines committed choices and authored fill, stroke, text, gradient-stop, and animation colors. Color/alpha deduplication, recent-use ordering, names, and pinned favorites share one UI across drawing defaults, Properties, and timeline paint controls. No separate Recent section.
- Collected colors remain available after artwork deletion. Collection runs with the originating document commit; palette metadata and artwork undo together, while playback and canceled drawing-color drafts do not add entries. Drawing defaults remain independent preferences; their palette entries are document-owned.
- Document envelope v7 adds optional validated project colors, with v6 migration and Project JSON/reload coverage. Artwork export/runtime formats remain unchanged. Fixed redo history so an edit after redo undoes to the restored state, and made the mutation revision reactive so all open palette surfaces refresh together.
- Verified 114 focused/adjacent palette, migration, persistence, paint, timeline, construction, reference, and history tests. Browser checks covered named/pinned colors, drawing reuse, gradient-stop reuse, live updates, undo/redo, and reload. Production build and diff checks passed.

Artwork/reference-image sampling followed this slice.

### Common drawing colors — October 23, 2026

- Added sidebar fill/stroke controls for new artwork, reusing HEX/RGB/HSL/alpha editing with explicit Apply/Cancel, Escape, swap, and no paint. Selection and existing artwork stay independent; invisible styles show feedback. Draft edits cancel on tool/document changes.
- Rectangles, ellipses, Pen, Line, Arc, and built regions share the drawing colors. Gestures capture colors at the start; open paths render stroke only, and Pen closure enables the captured fill. The initial drawing style is teal fill/stroke, replacing the earlier per-tool colors/unfilled-shape defaults; stroke widths remain unchanged.
- Preferences survive reloads outside document history. Model construction, import, restoration, duplication, and trimming retain their own paint behavior; no document schema change.
- Verified 105 focused/adjacent tests covering controls, preferences, creation, Pen snapping, paint editing, and characterization. Browser checks confirmed shared colors on rectangles/ellipses/lines, undo/redo, and saved colors/artwork after reopening. Production build and diff checks passed.

The unified Project colors palette and artwork/reference sampling followed this slice. Motion refinement follows the color-tools delivery.

### Native ellipse perpendicular snapping — October 23, 2026

- Line and straight Pen segments now snap perpendicular to native circles/ellipses, including rotated, reflected, sheared, and nonuniformly scaled references. The existing magnet, relationship feedback, screen-space capture/release, Alt bypass, and undo boundary are reused.
- Contacts solve the normal condition in canvas space. Finite interior-origin contacts and repeated roots are supported; zero-length connections, collapsed geometry, and the infinite family from a circle's center are excluded. Source ellipses remain native and unchanged.
- Extracted the existing polynomial root solver for reuse by cubic and ellipse contacts. No document schema changes.
- Verified 72 focused/adjacent geometry, Pen, Line, snapping, and overlay tests; browser checks confirmed a rotated ellipse's perpendicular preview, placement, and one-step undo/redo. Production build and diff checks passed.

Next: color tools, then motion-refinement foundation (onion skins and motion trails). Drag-to-paint regions/trim and gap controls remain drawing follow-ups.

### Trim and corner-radius follow-up fixes — October 23, 2026

- Ellipse trim/region output now uses compact editable arcs; a kept semicircle uses two Béziers rather than sixteen. Endpoint incidence handles either direction of a tangent line, so sequential trimming keeps both circles intact.
- Corner radius recognizes straight geometry stored as Béziers, including collapsed Pen handles. Closed paths include implicit closing edges and adjoining endpoints with separate identities. Editor geometry, export/runtime rendering, and stroke conversion agree without rewriting saved topology.
- Verified focused regression coverage for both circle trim orders, every corner of closed Pen paths, save/reload, undo/redo, and export. Production builds and diff checks passed.

### Curve joins, common tangents, region creation, and standalone trim — October 23, 2026

- Bézier endpoints acquire native circles/ellipses and align the adjacent handle to the analytic tangent. Existing endpoint drags preserve handle length and nested transforms; new Pen gestures preview the alignment while pulling handles. Alt bypasses it and cancellation restores the original geometry. These are geometric edits, not persistent constraints or curvature matching.
- Line and the first straight Pen segment support common tangents between two circles/ellipses. Start near the first outline, then approach a tangent contact on the second: both endpoints adjust together. External and crossing tangents are supported when they exist; Alt restores the freely placed starting point.
- **Shapes → Create shape** previews bounded regions formed by intersecting paths, circles/ellipses, rectangles, and arcs, including open construction lines. Click regions to toggle selection, then **Create shape** or Enter to merge them into one editable filled path. Original outlines remain; holes are retained.
- **Paths → Trim** is an independent outline editing tool. Hover to preview a span between intersections and click (or Enter on the preview) to remove it. With no intersections the span is the whole contour. Remaining pieces stay editable; trimmed native shapes become cubic paths with open contours. Stroke styling is retained; fill-only outlines gain a visible stroke. Each action has one undo entry.
- Both tools default to all eligible artwork, with **Selection only** to restrict the scope. Hidden, locked, clipped, motion-driven, and directly animated sources are excluded. Processing is bounded to 600 source curves; use smaller selections for dense artwork. Native ellipses use high-precision cubic outlines for construction; snapping retains analytic ellipses. No document schema change.
- Selected-object handles are hidden while creation/trim tools are active so resize targets cannot swallow placement clicks. Snap feedback remains visible. Escape, toolbar actions, mode/document changes, undo, and tool changes clear transient previews/selections.
- Browser checks covered common tangent placement, a region bounded by two circles and two tangents, standalone arc removal, trim undo/redo, and a new Bézier endpoint tangent join. 84 focused geometry, command, overlay, boolean/stroke characterization, and editor tests passed; production build and diff checks passed.

Follow-ups: drag-to-paint region selection/trim, gap-closing tolerance controls and further motion-refinement work. Native ellipse perpendicular snapping followed this slice.

### Line and arc construction, grouped drawing tools — October 23, 2026

- Paths groups Bézier/Pen and Line, with future freehand-to-path drawing planned in the same group. Shapes groups Rectangle, Ellipse/Circle, and Arc; the existing ellipse tool creates circles with Shift and centered circles with Shift+Alt, without a duplicate Circle tool. Lines support click-click and drag creation; arcs use center/start/end clicks or a center-to-start drag followed by an endpoint click. Shift constrains line angles to 15° and chooses the complementary long arc.
- Lines reuse point, intersection, tangent, and perpendicular snapping; arc centers/starts reuse eligible point/path snapping. Arc endpoints project onto the established radius without misleading off-circle snap feedback. Alt bypass refreshes with a stationary pointer.
- Construction remains a temporary preview until completion, with workspace origin/radius guides and stage instructions. Enter advances/completes; Escape, blur, cancellation, undo, document/mode changes, and tool switches discard incomplete geometry. No-op placement creates no history.
- `ConstructionDrawingService` owns gestures; `LayerOperationsService.insertElement` and `DocumentMutationService` own the final structural commit. Circles continue to use the existing ellipse tool. Arcs use a shared extraction of the existing SVG arc-to-cubic converter, preserving import behavior and serialization compatibility.
- Added accessible palette labels, keyboard activation, and ArrowRight to open tool choices. New line/arc strokes use the established shape accent for visibility on the artboard.
- Initial construction validation covered SVG import, snapping, overlay/editor integration, and browser drawing/undo checks. Palette regrouping passed 47 focused construction, preferences, snapping, overlay, and editor tests, including centered circles, sibling preview cleanup, saved tool restoration, and grouped Pen snap feedback; production build and diff checks passed.

Region selection/merging and independent edge trimming followed this slice (see above).

### Clipboard reference images — October 23, 2026

- Paste copied raster images/screenshots with Ctrl/Cmd+V over the canvas or the Tracing reference **Paste image** button. The panel opens automatically; the same fit, lock, validation, persistence, and undo boundary handles files and clipboard images.
- Native clipboard routing preserves text editing and object copy/paste, prioritizes image bytes over stale copied objects, and retains Shift+paste in place. Clipboard read failures offer the native paste/file-picker fallback; empty clipboards leave the document unchanged.
- Verified with 37 focused reference, clipboard routing, object arrangement/paste, and editor tests, production build, and browser checks for both image-paste entry points, undo, and subsequent object copy/paste.

### Tracing reference foundation — October 23, 2026

- Added one embedded PNG/JPEG/WebP reference beneath the artwork, with 40% default opacity and placement locked for immediate tracing.
- The sidebar's Tracing reference section supports replacement, opacity, visibility, removal, proportional numeric sizing, and fit to canvas. Unlocking exposes workspace move/resize controls with keyboard nudges; Escape, pointer cancellation, and blur discard the gesture draft.
- Every edit commits through the document mutation boundary. Project envelope v6 preserves references across reload and Project JSON round trips; separate source/placement history sections avoid duplicating image bytes during adjustments.
- SVG exports, runtime bundles, and thumbnails omit references. Import accepts embedded raster images up to 10 MB; remote URLs and SVG reference payloads are rejected.
- Verified with 44 focused reference/persistence/import/export/editor tests, production build, and browser checks for first import, undo/redo, move, resize, opacity, locked tracing, and reload.

Line and arc tools, alongside existing ellipse/circle drawing, followed this slice. Intersection splitting, region previews, and edge trimming are next.

### Native circle and ellipse tangents — October 23, 2026

- Straight pen segments now acquire both tangent contacts on native circle/ellipse objects, without converting them to paths. The exact affine ellipse is retained through nested rotation, reflection, and nonuniform scale.
- Uses the existing magnet, Alt bypass, feedback, and screen-space hysteresis. Visible locked references are eligible; hidden and clipped references remain excluded. Origins inside/on the outline and collapsed ellipses do not produce finite tangent targets.
- Native ellipse perpendicular snapping followed in a later slice; interior and intersection snapping remain separate follow-ups. No document schema or reference geometry changes.
- Verified 53 focused ellipse/contact/path/pen/rotation/overlay tests, production build, and whitespace checks. Browser verification confirmed the tangent preview, exact committed contact, unchanged native ellipse, and clean console output.

### Tangent/perpendicular placement and edge rotation — October 23, 2026

- Straight pen segments acquire tangent and perpendicular contacts on eligible cubic paths, plus perpendicular feet on straight segments. Contacts are computed from the current segment's fixed start in canvas space and use the existing 6-pixel acquisition/10-pixel release tolerance. Dedicated symbols and relationship labels distinguish these constraints.
- Contacts remain independent points; they do not establish a persistent constraint or split the reference path. Continuing a curved segment or dragging a Bézier handle does not claim straight-line tangency. Existing anchors/intersections keep priority when multiple relationships occupy the same point. Undefined cusp directions, zero-length construction lines, and infinite continua are excluded.
- Single and multi-object rotation aligns straight path edges and actual rectangle sides to visible reference edges, including locked references. Rounded rectangles contribute only their remaining straight side spans. Angular capture/release is 3°/5°, modulo 180°; Alt bypass updates immediately, and the shared magnet controls the feature. Existing Shift-to-15° increments for multi-object rotation take precedence.
- Alignment is solved in the gesture's parent/frame coordinates, including reflection and nonuniform parent scale. Motion-driven moving geometry and clipped geometry are excluded; existing shared-rotation availability limits remain. Feedback highlights both aligned edges in the workspace overlay.
- Rotation now consistently uses an object's custom transform origin. Completed gestures retain one history entry and Animate key capture; cancellation and no-op completion restore exact baselines and automatic origins.
- Verified 78 focused contact/geometry/pen/rotation/selection/overlay tests, production build, and whitespace checks. Browser checks confirmed tangent and perpendicular previews, tangent placement, exact 30° edge alignment, one-step undo, and clean console output. Full-suite testing remains for the final overhaul pass.

Next slice: reference images and construction shapes, followed by enclosed-region building and edge trimming. Native ellipse tangents followed this slice; native ellipse perpendicular contacts followed later; tangent/perpendicular editing of existing segments and persistent geometric constraints remain follow-ups.

### Path interiors and intersections — October 23, 2026

- Pen placement and existing-anchor drags now snap anywhere along eligible straight/cubic path segments, and to crossings without existing anchors. Queries include line/line, line/curve, curve/curve, self-crossings, and isolated tangent contacts.
- Interior captures slide along the segment with the existing 6-pixel acquisition/10-pixel release tolerance. Nearby anchors, midpoints, and intersections take priority over sliding; discrete targets retain their existing hysteresis. Squares mark path locations and crosses mark intersections in the shared overlay.
- Geometry is frozen in canvas space, preserving nested transforms and the existing moving-anchor/adjacent-segment exclusions. Queries reuse the installed Paper curve engine without creating scene items; nearby segment bounds filter intersection work and solved pairs are cached for the session.
- Coincident overlaps do not produce arbitrary intersection targets; their interiors remain snappable. Clipped groups, rounded vertices/adjacent segments, native shapes, and stroke outlines retain the prior limits. Snapping neither splits reference geometry nor welds point identities.
- Verified 80 focused geometry, pen/anchor, selection, object-snap, overlay, and editor characterization tests with the same Paper engine loaded by the app. Production build and whitespace checks passed. Browser checks confirmed intersection preview/placement, sliding anchor placement, one-step undo, and clean console output.

Tangent/perpendicular placement and flat-edge rotation followed this slice. Reference-guided regions and edge trimming are next, starting with reference images and construction shapes.

### Path anchor and midpoint snapping — October 23, 2026

- Pen placement and existing-anchor drags snap to visible path anchors, straight-segment midpoints, and cubic midpoints at parameter `t = 0.5`. Compound contours and implicit closing edges are included; visible locked paths remain usable references. Snapping to another path creates independent points rather than welding their topology.
- Point targets capture both coordinates together, with the same 6-pixel acquisition and 10-pixel release as object moves. Guide/canvas snapping remains the fallback. Circles identify anchors and diamonds identify midpoints, with fixed-size labels in the shared workspace overlay.
- The existing magnet controls both object and point snapping. Alt bypasses pen snapping; during anchor movement, press Alt after starting the drag to bypass. Alt held before an anchor drag retains the existing handle-conversion behavior.
- Anchor gestures preserve the pointer grab offset, move attached handles together, and respect nested rotation/reflection. Edit and Animate gestures commit once; Escape, blur, and no-op completion restore exact geometry and origins.
- Pen clicks keep their snapped preview through mouse release. A snap offset no longer turns a click into an accidental curve, and resuming an unfinished path no longer drops its working segment. Closing tolerance now stays consistent across zoom.
- This slice targets paths. Clipped groups, rounded vertices, and segments adjoining rounded vertices are skipped until rendered-outline queries are available. Moving anchors on motion-driven paths/ancestors is unavailable; Bézier-handle and segment drags retain their existing behavior.
- Verified 86 focused path/pen/snapping/transform/selection/overlay/editor tests, then 35 focused regressions after the final release-lifecycle fix. Production build and whitespace checks passed. Browser checks confirmed midpoint placement, anchor-to-anchor movement, one-step undo, and clean console output. Full-suite testing remains for the final overhaul pass.

Path interiors/intersections, tangent/perpendicular placement, and flat-edge rotation followed this slice. Reference-guided region building and trimming follows those precision tools.

### Object move snapping — October 23, 2026

- Single objects and selections snap their geometric edges/centers to visible artwork, guides, and canvas edges/centers. Visible locked artwork and locked guides remain references; moving objects, their descendants, and their ancestors are excluded.
- The header magnet toggles snapping and remembers the editor preference. Holding Alt bypasses snapping immediately, including with a stationary pointer. Resize, rotate, anchor editing, and keyboard nudging retain their existing behavior.
- Targets acquire within 6 screen pixels and release beyond 10, retaining the same relationship between nearby candidates. Passive workspace overlays show guide lines, target bounds, and relationship labels with fixed screen sizing.
- Nested transforms share the existing arrangement geometry. Clipped groups act as one target using intersected geometry bounds; strokes/effects are excluded. Snapping is unavailable for moving motion-path-driven selections or groups containing motion-driven descendants.
- Edit and Animate moves keep their existing one-gesture mutation boundary. Escape/blur and no-op completion restore exact geometry and ancestor origins; snapping preferences do not create document history.
- Fixed ruler measurement order on fresh canvases and stabilized viewport culling during Edit/Animate layout changes.
- Verified with 67 focused snapping/transform/selection/arrangement/overlay/preferences/ruler/editor tests, a production build, and browser checks for exact edge/top alignment, disabled snapping, keyboard toggling, and mode changes. Full-suite testing remains for the final overhaul pass.

Anchor/midpoint, path-interior, intersection, tangent/perpendicular, and flat-edge rotation snapping followed this slice.

### Object clipboard and arrangement — October 23, 2026

- Edit-mode Copy, Paste, and Paste in place work across documents and editor navigation in the same app tab. Ctrl/Cmd+C/V and Ctrl/Cmd+Shift+V are scoped to objects in Edit mode; Animate mode retains keyframe clipboard shortcuts and text inputs keep native behavior.
- Clipboard snapshots preserve draw order, nested ancestor transforms/opacity, clipping, shared path points, gradients, motion-path dependencies, and animation channels. Every paste remaps IDs and preserved SVG resource references. Referenced paths outside the selection are included hidden; pruned ancestor origins are pinned to the copied base state.
- Normal paste advances by 10 document units per paste; paste in place retains original canvas coordinates. Animation offsets remain consistent during playback. Destination duration extends when copied keys need more time. Each paste is one undoable structural mutation.
- Selection controls offer left/center/right/top/middle/bottom alignment to selection, canvas, or the last selected object. Equal-gap spacing keeps the outer objects fixed and requires three objects. Nested parent transforms, inherited locks, no-op completion, and one-step undo share the existing selection/mutation owners.
- Arrangement measures curve extrema and transformed ellipses, separately from existing transform-origin bounds. Strokes/effects are excluded. Motion-path arrangements remain disabled, as with shared transforms.
- Fixed fresh-project dialog/canvas initialization errors discovered while checking cross-project paste. Artwork and overlay references now share one template scope while retaining their sibling layout.
- Verification uses focused clipboard, arrangement, selection, Properties, timeline/page shortcut, SVG import, and fresh-project lifecycle tests, plus production build and browser interaction checks. Full-suite checks are reserved for the final overhaul/release pass.

Object/guide move snapping followed this slice. System clipboard exchange, cut, and persistent clipboard history remain later work.

### Shared canvas selection and transforms — October 22, 2026

- Canvas and Layers now share one ordered selection. Shift/Ctrl/Cmd-click toggles objects; dragging empty workspace starts an intersecting marquee, with modifiers to add. Marquee selects whole top-level groups.
- Shared outlines and handles move, proportionally scale, and rotate multiple objects around one pivot. Selecting both a parent and its descendant transforms the parent only. Inherited visibility/locks are honored.
- Nested objects use their parent coordinate systems. Siblings rotate in their shared parent space; cross-parent rotation is unavailable when it would require unsupported skew. Multi-object scaling is proportional; motion-path selections require detaching before a shared transform. The Properties summary explains restrictions.
- Ctrl/Cmd+A selects editable top-level objects. Arrow keys nudge 1 document unit in Edit mode, or 10 with Shift. Animate-mode arrows retain keyframe retiming.
- Escape and window blur cancel canvas transform/marquee gestures. Release outside the workspace finishes an active drag. No-op gestures leave no history entry.
- Completed gestures use the existing mutation boundary once. History restores the full selection by ID; animation capture reads all selected targets before writing any keyframes.
- Verified all 247 tests, the production build, and whitespace checks, including selection, transformed-parent, reflection, cancellation, history, and animation regressions; browser marquee, shared movement, scaling, rotation, and undo.

Followed by clipboard, alignment, and basic object snapping above. Persistent trash and whole-library backups remain later safety work.

### Project import and deletion recovery — October 22, 2026

- The gallery accepts SVG and exported Project JSON through one import action.
- Project import validates the file, applies existing migrations, preserves internal artwork/animation IDs and editable source, and generates a thumbnail through the shared renderer.
- Every JSON import receives a new project ID; duplicate names gain an imported-copy suffix. Existing projects are never overwritten.
- Unsupported versions and malformed artwork fail before saving. Preserved SVG fragments use the same sanitizer as the rendering boundary.
- Gallery deletion offers an Undo stack for the current tab session, without a timer. Recovery preserves artwork, thumbnails, timestamps, and gallery position. Reloading or closing the tab clears recovery; the UI states this limit.
- Saves, thumbnail updates, deletes, and restores use one serialized repository queue. An intentionally empty gallery stays empty after reopening.
- Verified all 232 tests, the production build, and whitespace checks, plus browser import, keyboard Undo, focus restoration, and playback of the restored animation.

### First handle visibility and usability pass — October 22, 2026

The artwork and transform/path/gradient controls already occupy sibling SVG surfaces. Controls project into workspace pixels and can extend beyond the artboard and artwork clipping masks. Keep that architecture; clip editor UI at the workspace boundary so it stays under surrounding panels and rulers.

- Preserve a 12 CSS-pixel segment hit stroke when a segment is selected; the visible selected stroke is only 2.5 pixels wide.
- Add segment hover feedback without letting the visible highlight intercept input.
- Add resize cursors that follow projected rotation and reflection, including parent transforms.
- Clarify transform, anchor, Bézier, and gradient handles with hover cues, contrast, selected-anchor fill, and accurate tooltips.
- Keep existing geometry, keyboard commands, gesture ownership, export output, and serialized documents compatible.
- Verified actual browser hit testing outside the artboard at 50%, 100%, and 200% zoom, selected-segment interaction, projected cursors, all 215 tests, the production build, and whitespace checks. Visually checked the local editor with the favicon starter project.

Follow-up overlay work: larger point/control hit areas with deliberate overlap priority, keyboard/focus access to controls, pointer-loss/cancellation audit, and the shared presentation of snap guides, measurements, and motion trails. These are not included in the first slice.

## Selection arrangement and snapping

Shared mechanics: selection state, geometry queries, coordinate projection, transforms, and temporary guide feedback. Extend the existing selection/domain owners; canvas and Layers must agree on the selected set.

First delivery:

- **Shipped:** canvas marquee and shared move/proportional-scale/rotate, with the transform limits described above.
- **Shipped:** app-session object copy/paste between documents, including paste in place.
- **Shipped:** align against the canvas, selection, or last selected object; distribute equal gaps within the selection.
- **Shipped:** moving-object edges and centers snap to artwork, guides, and canvas bounds.
- **Shipped:** pen placement and existing-anchor movement snap to path anchors/midpoints.
- Equal-gap snapping remains to do.
- Select underneath overlapping objects and repeat the last transform.
- **Shipped:** compact snapping control, highlighted targets, relationship labels, Alt bypass, and stable acquisition/release.

Next delivery:

- **Shipped:** snap to path interiors and intersections, including intersections without existing anchors.
- **Shipped:** tangent/perpendicular placement for straight pen segments; single/shared rotation aligns flat edges, within the limits above.
- Temporary extension lines and configurable grid/angle snapping.
- Target scope and candidate cycling; reuse the shipped acquisition/release hysteresis.
- Lasso, selection filters, property matching, and distance/angle measurements.

Acceptance: screen-space tolerances stay consistent across zoom; transformed groups resolve correctly; moving objects do not snap to themselves; one completed gesture creates one history entry; Escape restores the baseline and no-op completion creates no change.

## Drawing and path editing

Shared mechanics: contour topology, curve evaluation, intersections, and geometry-preserving mutation. Reuse the existing path helpers and boolean support used by stroke conversion.

First delivery:

- Line, polygon, star, arc, and donut creation tools.
- Join endpoints, split segments, reopen contours, and convert primitives to paths.
- Expose union, subtract, intersect, exclude, and divide operations.
- Build the reference-tracing and shape-builder workflow below after tangent/perpendicular placement and flat-edge rotation.

### Reference tracing, region building, and trimming

Requested workflow: place a reference image, trace its construction with overlapping lines, circles, and arcs, then select the enclosed regions to keep and trim unwanted edges. Schedule this after tangent/perpendicular snapping and flat-edge alignment so construction geometry is quick to place accurately.

1. Reference images are implemented as editor-only document aids, embedded in Project JSON and excluded from artwork exports. Line and arc construction tools are implemented alongside existing ellipse/circle drawing.
2. Implemented: split construction geometry at intersections to identify enclosed regions, including boundaries made from open curves; shared Paper adapters and boolean owners retain editable geometry.
3. Implemented: preview regions on hover, click to toggle them, then merge into an editable filled path. Holes and compound contours are preserved; Cancel discards the selection. Drag-to-paint and gap highlighting remain follow-ups.
4. Implemented: independent Trim previews spans between intersections and removes them as one undoable edit. Region creation keeps original construction geometry; layer visibility can hide it.

Acceptance: accurate intersections under nested transforms; deterministic handling of tangent contacts, overlaps, tiny regions, and gaps; keyboard/focus access to keep/discard actions; cancellation and undo restore originals. Define how splitting/merging affects animated points before enabling destructive topology edits on animated artwork.

Next delivery:

- Freehand/pen-to-path drawing with adjustable smoothing and stabilization, grouped with Bézier/Pen and Line in Paths.
- Curve creation with less manual handle management.
- Simplify paths with a live error-tolerance preview.
- Mirror/symmetry drawing and editable offset paths.

Acceptance: preserve transforms, compound contours, fill rules, and shared point identity; define how topology changes affect animated anchors and report unsupported cases before applying changes.

## Color tools for creating artwork

Shared mechanics: paint editing, drawing defaults, reusable color values, document color discovery, and coordinate-aware sampling. Extend the existing `PaintEditorComponent`, `ColorAttribute`, and `PaintEditingService`; reuse the gradient preset owner for existing gradient presets. Active fill/stroke defaults, the unified Project colors palette, and artwork/reference sampling are shipped. Recent choices and project colors share one palette, as requested October 23, 2026; there is no separate Recent section or global recent-color store.

First delivery, implemented in this order:

1. **Shipped: active fill and stroke colors.** Persistent, easily accessible controls for the colors used by new artwork, with a clear active target, swap, and no-paint actions. Closed shapes and created regions use the active fill/stroke; Line, Arc, and open Pen drawing use the active stroke, preserving stroke width. Creation defaults remain distinct from editing selected artwork so changing selection does not silently overwrite the drawing colors. Invisible drawing styles show explicit feedback.
2. **Shipped: Project colors, one reusable palette.** Combines colors already authored in the current project with committed color choices in one deduplicated palette, shared by drawing defaults, fill, stroke, and gradient-stop controls. Discovers fill, stroke, text, gradient-stop, and color-keyframe values, including hidden and locked artwork. Includes committed typed, adjusted, and swatch-applied choices; sampling uses the same path. Coalesced edits collect the committed value, not every input event or playback frame. Newly used colors move forward; named/pinned favorites remain first. Collected colors remain after their last artwork use is removed. Alpha is visible and no paint is distinct from transparent color. The palette saves with Project JSON and restores on reload; each project keeps its own colors. Ordinary application copies a color value. Linked swatches and global recoloring remain a later extension with explicit shared-edit semantics.
3. **Shipped: Eyedropper for artwork and reference images.** Start from the fill, stroke, or gradient-stop target and preview the sampled color before committing. Provide a visible choice between the artwork's displayed color and the original reference-image color. Reference sampling reads source pixels independently of tracing opacity and overlapping artwork, respects reference placement and canvas zoom/pan, and works with locked references. Show a magnified sample and color value; out-of-image and fully transparent samples must not invent a color. Core in-editor/reference sampling must work without relying on a browser-specific screen eyedropper; broader screen sampling is an optional enhancement.

Example workflow: paste a reference, sample its original colors into Project colors, set a common fill/stroke, construct and trim shapes, then reuse the same palette for details and gradient stops.

Ownership and interaction requirements:

- Drawing defaults remain editor preferences; the unified palette, saved names/pins, and reuse ordering belong to the document. Derive currently used colors from authored data and merge them with retained choices for one palette view; do not maintain a second recent-color store. Capture palette additions alongside the originating edit in the same document mutation, without an extra undo step. Choosing a drawing default adds to the current project's palette only when a project is open.
- Sampling owns temporary preview state and converts workspace coordinates to image pixels through the existing reference placement. Shared color controls expose the same reuse/sampling interactions wherever their capabilities allow them, including timeline color controls.
- Persistent artwork and palette edits use `DocumentMutationService`; animated color edits retain existing Animate-mode behavior. Adding saved palette data requires compatible defaults, document validation, and migration/round-trip coverage as appropriate. Editor palettes and references stay out of artwork exports.
- Pointer and keyboard activation, focus return, Escape cancellation, tool/document switches, no-op completion, and one undo entry per committed artwork/palette edit are part of the delivery.

Acceptance: draw several shapes with common colors; reuse one palette across drawing defaults/fill/stroke/gradient stops; reopen a project and recover its colors, names, and pins; deduplicate colors discovered from both artwork and committed choices; keep project palettes independent; retain collected colors when artwork is deleted and restore palette changes on undo; sample the same reference pixel at different tracing opacities and zoom levels; verify cancellation and undo/redo. Run focused paint, creation, reference, persistence, and adjacent animation tests plus browser interaction checks for each implementation slice.

## Timeline and motion refinement

Shared mechanics: track evaluation, timeline selection, retiming, and projected animation previews. Extend the current timeline services and compiled evaluation pipeline.

First delivery:

- **Shipped:** onion skins and selected-object origin trails with time ticks; see the foundation slice above for scope and sampling limits.
- Stretch, compress, reverse, and offset selected keyframe blocks.
- Ping-pong preview and editor playback-speed controls.
- Inspect position/value/speed continuity at a loop seam.

Next delivery:

- Optional frame-based timing, frame stepping, and frame-rate controls.
- Value graph alongside the existing speed graph.
- Editable markers. Named reusable animation clips are consolidated into C1 **Actions**, with their placements delivered in C2; do not build a competing clip system.
- Trim-path start, end, and offset controls.
- Assisted path morphing with explicit contour/point correspondence.

Acceptance: retiming preserves relative spacing and easing semantics; preview controls do not leak into base artwork or exports; named clips and new animation properties use versioned migrations and editor/runtime parity fixtures where required.

## Actions, actors, and scene composition

Integrated October 24, 2026 from the supplied discovery brief, `SVG_ANIMATION_COMPOSITION_PLAN.md`. This section incorporates its product direction into the authoritative roadmap. The initial audit and broader implementation gates remain below for context; the completed slices above record delivered actions, scene placements and rigging. Linked actor instances remain planned.

Scope correction, October 24: the user requires complete character-rig creation, binding with weights per point, and FK/IK posing. This supersedes the brief's suggestion to defer bones and weighted deformation. Physics simulation remains separate deferred work.

### Product concepts and editing experience

| Concept | Meaning | Relationship to current workflow |
|---|---|---|
| Action | Named animation source with its own duration, property tracks, and explicit targets | Reuses detailed keyframe and speed-graph editing |
| Action instance | A linked placement of a source action in scene time | Moving a block changes its placement, not source keys |
| Actor | Character, prop, or other artwork collection with associated actions and optional controls | Initially ordinary artwork/groups; linked reusable actor definitions arrive in E |
| Rig / armature | Bone hierarchy, rest/bind data, weighted SVG-point bindings, FK/IK controls and action associations | C3 delivers creation, binding and posing; multiple independent rigs and multiple rigs per actor must be possible |
| Scene / composition | Artwork plus direct scene animation and scheduled action instances | Initially one composition in the existing document; nested compositions come later |

Keep **Edit / Animate** as the existing distinction between base artwork and animation authoring. Within Animate, distinguish the document's property timeline, a focused action timeline, and scene action blocks. The existing Timeline / Graph switch remains a choice of detailed editing surface, not a substitute for action/scene context. Final layout needs a focused prototype rather than a new collection of global modes.

Show the active context, source action name, target scope, and local versus scene time explicitly. Opening a block edits its source only through a clear action; instance timing controls remain separate. Returning to the scene restores its playhead, selection, and viewport. Changing context ends or cancels active gestures through their current owners and restores preview base state before switching. Canvas and Properties key creation must write to the same active animation context as the timeline.

Initial action scope is an explicit set of elements/properties in one document, optionally selected through a group. No rig is required, and action targets need not be characters. Cross-actor retargeting and cross-project action libraries wait for validated bindings; matching names alone is not a safe binding strategy.

### Pre-composition implementation audit and reuse boundaries

The following is the historical pre-composition assessment from October 24, before action sources, placements and rig animation shipped. Its references to then-current schemas and missing capabilities are retained as implementation context, not an outstanding-work checklist:

| Existing implementation | Reuse | Required extension |
|---|---|---|
| `AnimationDocument` / `AnimationTrack` in `animation.object.ts` | Typed property tracks, stable target IDs, easing, temporal handles, duration and markers | Current animation schema v2 contains one track collection, not reusable sources or placements |
| `TimelineEditingService`, `TimelineEditorService`, timeline and graph surfaces | Key selection, copy/paste, retiming math, virtualized rows, graph interaction | Bind detailed editing to an explicit animation context; current playback/key lookup targets `selectedSVG.animation` |
| `AnimationPlaybackService`, `AnimationGestureService`, paint editing | Key creation, gesture capture, base-state restoration, preview lifecycle | Route all animation writes to the active context; isolate local-time preview from scene evaluation |
| `AnimationEvaluationPlan` and property adapters | Compiled interpolation, deterministic seeking, typed outputs, target/property lookup | Resolve action-local times and contributions before applying a final value per property; track iteration order is not a conflict policy |
| `ImperativeSvgRenderer` and workspace overlays | Retained SVG output, projected editor aids | Render resolved composition output; motion trails/onion skins must sample the same evaluation without changing document state |
| Groups, `ElementFactory`, object clipboard and reference remapping | Artwork hierarchy, independent copies, stable-ID remapping | Groups/copies are not linked actor definitions; actor instances require explicit source-to-instance bindings, including path-point and gradient IDs |
| `DocumentMutationService`, history, sequential document migrations | One edit/one undo, base-state persistence, project validation | Include action sources, placements and future bindings in save/restore/history and invalidation; current envelope is v8 |
| `compileRuntimeAnimation`, runtime contracts and parity fixtures | Deterministic compilation, existing property channels, shared temporal math, supported SVG/ZIP publishing | `RuntimeBundleV1` has property tracks but no action scheduling or mixing contract; prove exact lowering or introduce a versioned runtime capability |

Prefer narrow context interfaces and cohesive scheduling/binding helpers within these boundaries. Do not copy the timeline service, create a second renderer, or put composition behavior into `EditorPage`. Detailed actions and document animation should share editing commands; action blocks need their own gesture owner while reusing timeline coordinate and snapping helpers.

Foundation handoff, October 24: detached inspection is now implemented and verified. The next action-context slice must cover timeline queries/commands, canvas gesture key capture, property/paint edits, playback and inspection together; replacing only the visible track list would leave edits writing into document tracks. Keep the selected SVG stable while changing the active animation context. Preserve separate local/scene playheads as session state and restore preview values before changing contexts. Extend the inspection sampler's evaluation input when actions land rather than introducing a second ghost renderer.

The C0 export review confirms that current runtime tracks hold endpoint values and contain no active-interval contract. Repeated action blocks with inactivity gaps cannot be implemented faithfully by simply concatenating keys. Before C2 playback ships, prototype inactive-interval/base restoration in editor/runtime parity fixtures and decide the required versioned runtime capability. This is a concrete dependency, not a reason to replace the existing interpolation or SVG rendering engines. Resolved by the action-composition slice: runtime 1.1 uses explicit action windows with direct/base fallback; editor/runtime fixtures cover gaps and boundaries.

### Broader composition semantics and follow-ups

The completed slice above defines the shipped contract. The following broader defaults remain design guidance for C2 refinements and actor support; rate and trim are implemented; actor binding remaps and blending remain planned.

- **Linked source versus placement:** source edits update all linked placements. Duplicating a placement retains its source link; duplicating an action creates an independent source. Action deletion must show references and support a deliberate atomic removal of affected placements, with undo. No silent dangling references or automatic source duplication.
- **Time:** start with positive-rate playback and an explicit active interval. Define local time from placement start and source in-point; candidate mapping is `local = inPoint + (sceneTime - start) * rate`. The smallest release uses rate 1 and the full action duration. Trim, rate, finite repetition, and reverse follow only after boundary behavior is specified. Repeats use a defined cycle length, never playback-history-dependent counters.
- **Boundaries:** proposed placement activity is start-inclusive/end-exclusive; outside it, the action contributes nothing. Explicitly test adjacent blocks, exact end times, scene-end display, source-duration edits, and future loop seams. Do not inherit ordinary track endpoint holding across an inactive block. A future hold-last-pose option must be explicit.
- **Base state:** evaluate from authored base values and direct scene tracks at the requested scene time, then resolve active action contributions. Channels absent from an action retain that underlying state. On exit, return to the currently evaluated underlying value, not the last frame played or the action's starting pose.
- **Overlap:** independent target/property channels may overlap, such as body idle plus eyelid blink. For the MVP, reject new placements/edits that create competing action writes to the same resolved channel and interval, and show the conflicting sources, targets, and properties. Invalid loaded data receives an explicit diagnostic and cannot silently export with last-writer-wins behavior. Priority, additive mixing, masks and crossfades are later capabilities.
- **Direct scene keys:** preserve direct animation. For the MVP, reject action/direct-track ownership collisions on the same channel rather than silently overriding either. Scene positioning can use an outer group's transform while internal actions animate descendants. Fine corrections can edit the action source or an independent action copy; a separately designed override layer follows later. Conservative conflict checks may reserve an entire direct track's channel initially; document that limitation in the UI.
- **Targets:** use explicit IDs within the current document first. Future reusable actors need stable source-relative bindings resolved to unique instance IDs, never shared mutable element objects. Coordinate spaces, custom/automatic origins, clipping and motion-path references must remain correct. Initial actions are absolute property animation; additive/relative actions require separate semantics.
- **Topology and missing targets:** preserve path-point correspondence. Deleting or replacing targeted geometry must identify affected actions/placements and rig bindings and offer a reversible explicit operation. Reject incompatible retargeting rather than silently mapping points by array index. Topology-changing actions remain deferred; C3 weighted deformation preserves authored topology and stable point IDs.

Before implementation, resolve the remaining design choices: create-from-keys copy versus extraction (and replacement of the original animation), source duration edits versus placement lengths, exact boundary display, supported initial property families, future priority/override semantics, and runtime representation. These are implementation gates, not reasons to delay the shared motion-preview foundation.

### Phased backlog and acceptance gates

| Slice | Deliverable | Completion evidence |
|---|---|---|
| C0 Integration design | Context/ownership prototype, binding/time/conflict examples, migration and export feasibility spike | Existing direct animation works unchanged; decisions above are recorded before schema changes |
| C1 Action authoring | Create/rename/duplicate/remove named sources; focused local-time editing using existing keyframe/graph controls; isolated preview | Edit `Blink` without changing document animation; undo/redo, context switches, save/reload, and legacy projects pass |
| C2a Minimal scene composition | Place, move, duplicate and delete linked blocks; full-duration rate-1 playback; channel conflict feedback | One `Blink` source plays twice, and editing its keys updates both placements; surrounding artwork remains editable |
| C2b Composition timing | Independent nonconflicting actions; deliberate trim/rate/repetition controls; clear local/scene navigation | Body `Idle` overlaps two blinks; exact boundaries, backward/random seeks, and supported exports agree with preview |
| C3a Rig creation | Create/edit bone hierarchies, joint placement, parenting, rest pose and multiple armature scopes | Build body/face/tail or prop rigs without changing unrelated artwork; rest edits are distinct from pose edits |
| C3b Binding and weights | Bind SVG artwork to bones, inspect/edit per-point influences, visualize weights and unbind/rebind | Selected anchors and Bézier controls deform predictably; zero-weight points, normalization, undo and reload behave explicitly |
| C3c Posing and animation | FK bone transforms, IK chains/targets, bend controls, pose reset, keyed poses and reusable actions | Pose a bound character with FK and IK, animate it through actions, and reproduce the pose on arbitrary seeks and export |
| D Action-aware motion tools | Existing planned presets, stagger, springs and bake using shared action/track semantics | Generated motion stays editable; applying a recipe is distinct from linking a source action |
| E1 Reusable animated actors | Artwork/rig/action resources with explicit instance bindings, independent placement and timing, detach/copy semantics | Two instances of the same character perform different sequences and poses; source edits propagate without leaking instance state |
| Later scene extensions | Cues, nested compositions, override/mix layers, crossfades, parameter poses and constraints | Added only with deterministic semantics, compatibility fixtures and demonstrated authoring need |

**Smallest useful end-to-end milestone is C1 + C2a, not an action library alone:** create one editable blink on an existing SVG group, place it twice at different scene times, edit its source once, undo/redo both source and placement edits, save/reopen, and export matching playback. No skeletal system, linked actor library, nested scenes, or advanced blending is required. Nonconflicting idle plus blink is the immediate C2b extension. C0 may run as preparation for C1, but implementation starts only as separately scheduled feature work.

### Required character-rigging workflow (C3)

Character rigging is complete only when creation, binding/weights, and posing work together. Deliver these as focused slices of one required feature, not optional advanced extensions.

1. **Create the rig:** add bones and joints, establish parent/child chains, name/select controls, edit the rest pose, and associate artwork with an armature. Keep rest-pose editing visibly distinct from posing. Support multiple independent armatures in a document and multiple sub-rigs within a character; cross-rig constraints can wait.
2. **Bind and weight:** record bind/rest transforms and associate stable SVG point IDs with bone influences. Provide point selection, numeric influence editing, weight visualization, normalization rules and explicit unbind/rebind operations. Cover path anchors and Bézier control points; handles inherit anchor weights by default and can opt into independent weights. Exactly coincident points in a binding scope share weights without merging SVG geometry. Unweighted points must have defined behavior. Automatic weighting and weight painting build on manual per-point editing; they do not replace it. See the next rigging milestone below for the selected-artwork workflow.
3. **Pose with FK and IK:** manipulate bones directly with FK; define IK chains, targets, bend direction/pole controls and chain limits. Specify reachable/unreachable target behavior, zero-length chains, transform-space conversion, and whether stretch is supported. Provide reset-to-rest and deliberate FK/IK switching or matching so changing the control method does not unexpectedly jump the pose. Start with a documented bounded IK chain scope, then extend it; IK itself is required.
4. **Animate the pose:** key bone/control parameters into the active action, preview the deformed SVG, and sequence the resulting action in the scene. Rig actions remain editable at the control level rather than immediately baking every deformed point. Direct path animation stays available, but its ordering relative to deformation and any corrective offsets must be explicit. Do not permit two independent owners to overwrite the same final geometry silently.

Preserve base SVG geometry and bind data separately from evaluated pose output. A proposed evaluation order is action/direct control channels, FK transforms, IK solution, then weighted point deformation and SVG rendering. Finalize direct point animation/corrective ordering and the deformation method with fixtures before committing a schema. Solvers must produce the same pose for the same time and inputs regardless of previous playback frames; caches cannot become hidden pose state.

Bind transforms must account for nested groups, custom origins, nonuniform scale and reflection. Review the existing path-property adapters, motion paths and geometry bounds for interaction with deformation. Weight/bone data requires validated serialization, stable references, compatible migrations, and history ownership. Deleting a bone, reparenting, editing the rest pose, or changing bound path topology must expose its binding consequences and remain undoable.

**C3 acceptance:** construct a small multi-bone character/limb, bind a cubic path with blended point influences, inspect and change weights, pose it using FK and IK, and save the pose animation as an action. Verify reset, cancellation, undo/redo, reload, mirrored/nested artwork, unreachable IK targets, independent armatures, and arbitrary seeks. Character-rigging delivery also requires matching supported animated exports: either a shared versioned rig evaluator or an explicitly specified bake with documented tolerance and parity checks. Baking is a publishing operation and preserves editable rigs/actions in Project JSON; no silent frame sampling or unsupported rig export.

### Compatibility, export, and verification

- Keep legacy document tracks and their evaluation unchanged when no composition data exists. Add sequential document migration/validation fixtures before introducing action data; determine whether the animation schema also needs a version increment. Unsupported future documents retain existing read-only protection. Empty action collections must not change old project output.
- History must capture source edits, block edits, bindings and referenced resources through the existing mutation boundary. One drag or extraction operation commits once; cancel/no-op creates no save. Context/playhead/selection remain session state. Source edits invalidate every dependent placement; structural edits invalidate resolved bindings. Include palette discovery and animation-track cleanup in the dependency audit so action-only colors and targets are not missed.
- Do not promise that concatenating copied keys preserves composition. Track endpoint holds, inactivity gaps, abrupt return to an underlying track, temporal easing and retiming can differ. C0 must demonstrate exact lowering to the existing runtime or choose an explicit version/capability extension shared by compiler and player. Fixed-frame sampling is not an undisclosed substitute for exact editable animation.
- Supported animated exports must match scene evaluation before the composition milestone is considered complete. During development, unsupported combinations receive actionable diagnostics rather than silently losing actions. Static SVG keeps its established base-artwork semantics, and Project JSON retains editable sources and links. Do not change embedded/exported bundle contracts implicitly.
- Test reusable blink, idle-plus-blink, direct-track conflicts, adjacent blocks, missing bindings, source edits/deletion, context-switch cancellation, undo/redo, legacy loading and round trips. Compare forward playback, backward/random seeks, exact boundaries, and editor/runtime DOM output, including temporal handles, path points, transforms/origins, colors and gradients as each family becomes supported.
- E acceptance adds two independent instances, multiple armatures in one scene, several armatures within one actor, and source-relative point/gradient remapping. Add representative many-block performance fixtures so compilation/invalidation and timeline virtualization remain practical without cloning source tracks every frame.

### Relationship to the rest of the roadmap

Motion trails and onion skins are shared infrastructure for direct animation, action editing, rig posing, and scene inspection. Keyframe-block retiming remains a detailed-track operation; moving/stretching action blocks is a separate operation on placements. Named clips are Actions; saved animation recipes and linked action sources have distinct behavior but should not duplicate resource storage. C3 adds bones, weighted SVG-point deformation and FK/IK to the same animation foundation. Actor definitions extend the planned symbols/resources work and package those rigs with artwork/actions. Full physics and expression/state systems stay deferred.

Existing drawing, color, typography, project-safety, accessibility and publishing work remains planned. The original pony-at-a-desk scenario is the long-term acceptance walkthrough: idle, two blinks, look toward the door, and smile, with independent scene timing and one shared editable blink source. The same mechanisms must work for a door, machine, or abstract graphic without character-specific code.

## Animation presets and procedural motion

Shared mechanics: parameterized motion, reusable animation data, deterministic evaluation, and baking. Start with recipes that generate existing keyframes; introduce a shared evaluator when continuous behaviors need one.

First delivery:

- Save/apply pop, bounce, fade, slide, draw-on, overshoot, and custom presets.
- Stagger by layer order, distance, grid position, or seeded ordering.
- Spring/settling and squash/stretch controls.
- Preview controls and bake-to-keyframes with the source preserved.

Use the C1/C2 action model for reusable animation sources and placements. Presets may generate independent keys/actions; applying a recipe must not silently create a live source link. Avoid a separate preset playback engine.

Next delivery:

- Follow, look-at, delayed follow, and transform parenting independent of layer grouping.
- Seeded wiggle, controlled motion variation, motion echoes, and seamless orbit/wave loops.
- Audio waveform, beat markers, and amplitude-driven controls.

Acceptance: select objects, choose a preset, adjust a few useful controls, preview, then apply. Keep results reversible; record seeds when baking; require deterministic seeks and equivalent exported playback.

## Reusable styles and assets

Shared mechanics: named resources, references, instances, and explicit overrides. Extend the existing paint and gradient preset owners rather than duplicating resource logic.

- Linked swatches, named styles, and full appearance pickup extend the earlier color-tools delivery. Basic project swatches and the color eyedropper shipped there.
- Linear, radial, and path repeaters.
- Reusable symbols with instance overrides and component variants, extended into E1 animated actors with action collections and explicit target bindings.
- Package C3 bone hierarchies, bind transforms, per-point weights and FK/IK controls with reusable actors. Resolve each instance's bones, targets and points independently, including multiple rigs per scene and sub-rigs per actor. See the composition integration above for delivery gates.
- A personal library of shapes, components, palettes, and animation presets.
- Group isolation, layer search/filtering, solo layers, and named selection sets.
- Multiple artboards after selection, reusable resources, and document migration support are ready.

Acceptance: distinguish linked instances from independent copies, make shared edits predictable, and preserve usable resources through project backup/restore.

## Appearance and typography

Shared mechanics: paint, stroke, text layout, resource definitions, and matching authoring/export renderers.

First delivery:

- Embedded reference images and cropping.
- Arrowheads and path markers.
- Text spacing, styled spans, text-on-path, font handling, and text-to-outlines.
- A small editable effects set: shadow, blur, and glow.

Next delivery:

- Pattern fills, variable-width strokes, alpha/luminance masks, and blend modes.
- Vector effects and paint-order controls.
- Native nested SVG/viewBox and reusable defs/symbol/use semantics.
- Expand editable import coverage from the real-world corpus while retaining sanitized preservation as a fallback.

Acceptance: add migration and import/save/reload/export/visual fixtures for each new persisted SVG family. Report preservation as partial import, not native editability.

## Project safety and editor usability

Shared mechanics: project lifecycle, persistence, history, focus, and command dispatch. Deliver these alongside the creative feature sets.

First delivery:

- **Shipped:** import exported Project JSON through existing migrations as a new copy.
- **Shipped:** session Undo for gallery deletion; a persistent trash area remains a possible follow-up.
- Duplicate projects and expose save/recovery status clearly.
- Keyboard-accessible tools, tabs, and menus.
- Audit Escape, pointer loss, blur, release outside the workspace, and no-op interactions.

Next delivery:

- Named checkpoints and whole-library backup/restore.
- Gallery search, sorting, and folders.
- Command palette, shortcut reference/customization, and workspace presets.
- Offline installation and a touch/pen interaction pass.
- Recovery tests for storage exhaustion, interrupted saves, multiple tabs, and reopening after failure.
- Performance diagnostics for expensive artwork and playback.
- Keep feature/compatibility/deployment documentation accurate and remove development console noise.

Acceptance: retain old project readability, never overwrite unsupported future envelopes, commit mutations once through the established boundary, and preserve clear storage-failure feedback.

## Preview and publishing

Shared mechanics: export artifacts, compatibility diagnostics, and editor/runtime parity.

First delivery:

- Export selected objects and PNG stills.
- Preview the actual exported result and compare it with editor playback.
- Explain supported embedding contexts and fallbacks for each format.
- C1/C2 composition publishing: preserve action timing, inactivity, and conflict semantics through exact compilation or a versioned runtime extension, with editor/runtime parity as a release gate.
- Author accessibility titles/descriptions and reduced-motion alternatives.

Next delivery:

- Image sequences, video, animated images, and sprite sheets.
- Batch sizes, themes, artboards, and clips.
- SVG optimization with precision and appearance previews.
- Practical vanilla JavaScript, React, Vue, and Angular integration examples.
- Font Awesome project/icon export with stroke-to-shape validation, naming, sizing, variants, and metadata.

Acceptance: export contains no editor overlays; cancellation and diagnostics are actionable; static SVG remains script-free; animated delivery retains deterministic compilation and playback parity.

## Deferred expansions

These remain candidates after the core creation workflow is established:

- Typed expressions and a node editor. Use one versioned AST/DAG for both the text DSL and any later visual editor; include typed variables, time/property references, math, conditions, registered safe functions, cycle diagnostics, and deterministic topological evaluation.
- Full physics simulation, including gravity and pendulums, remains deferred. Bone creation, weighted point binding and FK/IK posing are required C3 character-rigging work, not deferred physics features. Use fixed-timestep simulation with baking where simulation is needed. Expressions, physics, rig controls, actions and keys must share one property-evaluation pipeline.
- Use fixed seeds by default; an explicit randomize-on-load option may vary runtime playback, and baking must record the effective seed.
- Interactive states, transition blending, hover/click/focus/scroll triggers, runtime variables, responsive layouts, and data-driven artwork. Serialized runtime variables already exist but do not yet drive expressions or state transitions.
- Optional device sync, review links, and collaboration.

## Completion standard

Each implementation slice has one state owner, reuses existing behavior, preserves layout and event boundaries, and includes relevant interaction or characterization tests. Persistent changes finish through `DocumentMutationService`; structural operations use `LayerOperationsService`/`LayerCommandService`. Serialized changes require sequential migration fixtures before new behavior lands.

Run focused tests and adjacent interaction checks during feature work, plus `npm run build` and `git diff --check`. Reserve `npm test -- --watch=false` for the final overhaul/release pass. Check changed interactions in the browser. Update the current slice status and shipped feature inventory only after verification.

### Completed: bounded two-bone IK posing

Connected length-bone pairs support a draggable Pose-mode target, bend flipping, non-stretching reach limits, ancestor-space conversion, keyboard target nudges, cancelable previews, and one-commit solved poses. Point/length creation uses click versus a five-screen-pixel drag. This first interactive solve stored FK poses; the following milestone adds persistent target constraints. Keyed rig actions and animated export followed in the October 25 slice above; pole controls/limits remain planned.

### Rigging milestone: target constraints and a dedicated weights workspace

Design decisions from the character/feet setup review. Persistent constraints, the weights workspace, group/shared-point weights, independent handles, painting and rig animation are implemented; the explicitly identified broader refinements remain planned.

**Independent targets and constrained chains — implemented.** A Foot point under the armature root is a valid planted-foot control. Bone parenting determines inherited movement; an explicit constraint determines which leg the point controls. Named two-bone IK constraints store stable upper/lower/target bone references, enabled state and bend direction. A target must not descend from the chain it drives. Moving Body in Pose re-solves both legs toward stationary feet; moving the armature root moves the whole character and its targets. A target parented under Body instead follows Body. Artwork draw order stays intact.

Create a constraint by selecting a lower bone, choosing an existing point or New point at leg / arm tip, and clicking Add IK constraint. Selecting a chain bone or target exposes the same named constraint inspector, with enable, target, flip bend, match-to-tip and removal controls. Layer constraint badges, mix controls and explicit ordering feedback are future refinements. Physics/secondary-motion constraints can later reuse this card structure with their own parameters; physics controls wait for an evaluator.

One constraint evaluator runs after authored FK and before rigid/weighted artwork evaluation. References, overlapping writers and dependency cycles are validated; valid dependencies evaluate deterministically. Edit rest/setup changes suspend solving while preserving visible artwork; Pose resumes solving toward controls. Match target to tip explicitly aligns a control before resuming. Reset in Edit clears authored offsets with solving suspended; Reset in Pose clears offsets and evaluates enabled constraints. Links, settings and suspension persist; selection does not change evaluation. Static artwork remains materialized for existing rendering/export. Rig keyframes now use the shared control-channel pipeline described above. Physics also requires fixed-step evaluation, reset/replay for arbitrary seeks and editor/export parity.

**Artwork-first Binding / Weights workspace — implemented for paths and groups.** The Bone setup / Pose / Weights inspector offers Assign bones / Edit bones, with zero/one/multiple assignments selecting unbound/rigid/weighted behavior. Native paths retain point binding metadata; other artwork uses single-bone transform attachments. New weighted bindings and rigid-to-weighted transitions receive spatial automatic weights; later multi-bone assignment changes retain manual values and add bones at zero. Rest-pose attachment conversion commits atomically. Artwork-first scope follows selected artwork layers, while bone selection retains the artwork scope. Complete group setup preflights descendants, including clipping paths; unsupported shapes/text require explicit conversion. No hierarchy or draw-order changes occur.

The workspace provides stable bone colors, direct multi-point selection, mixed-value percentage/slider rows and persistent influence locks. Auto weights previews nearest-two-bone rest-space assignments for selected owners or the current scope. Shared owners count once and all their markers highlight. Add/Subtract/Set/Smooth brushes use screen-pixel radius and the same locked-budget normalization; selected owners restrict painting. Temporary colors preview before one release commit. Shared owners and inherited handles receive one update per stroke, and cancellation changes no weights. Bone-first reverse scope shows controlled points across artwork and optionally includes eligible zero-weight points. At overlapping screen positions, a popover exposes independent owners for inspection, editing and additive selection. Selected-influence Heat and mixed-influence Mix views are available.

**Coincident points and independent Bézier weights — implemented.** Initial binding shares weights at exactly overlapping captured rest positions in the selected scope, including transformed group children. Original point IDs, contours and clipping geometry stay intact. Explicit ownership survives poses and rest edits instead of rediscovering coincidences from deformed geometry. Share weights at exact overlaps joins existing sets using the first owner's values; Make separate copies current values before unlinking. Removing an owner rehomes surviving members. Geometric anchorId remains separate from weight ownership. Independent handle weights copies inherited values before separate numeric editing or painting; disabling it restores anchor inheritance. Explicit empty independent weights mean no deformation, with no fallback. Independent weights can change curve smoothness; no silent geometric welding or tangent changes occur.

**Delivery order and acceptance.**

1. **Done:** persistent target-bone IK constraints and unified pose evaluation. Acceptance covers planted feet while moving Body, independent legs, rotated target parents, cycle/deletion/reparent diagnostics, Edit/Pose matching, reset, undo and reload.
2. **Done:** selected-artwork Binding / Weights workspace, editable multiple influences, stable colors and all-point display with inherited handles. A whole leg path can assign different anchor weights across upper/lower bones. A straight segment with no knee anchor still needs a geometry point at the intended bend; weights cannot add path geometry.
3. **Done:** group binding, shared coincident-point weights and independent handle overrides with versioned persistence. Legacy inherited handles, topology, draw order and current artwork remain intact; explicit zero weights, transformed seams, owner removal and atomic failures have focused coverage.
4. **Done:** Add/Subtract/Set/Smooth painting, bone-first reverse scope and independent overlap-group inspection/editing. Temporary colors, keyboard dabs, cancellation and one-stroke commits share the established weight model.
5. **Done:** unified assignment, automatic rest-space weighting, selected-owner slider/numeric editing, locks, selection-limited painting and explicit legacy custom weights. Check initialization versus preservation, zero/one/multiple assignments, mixed selection, normalization, preview cancellation and migration.
6. **Done:** bone/control keyframes, reusable armature actions, deterministic seeking and animated export through the shared rig evaluator. Keep source-time action editing, multi-channel undo, context cancellation and editor/runtime parity as regression gates.
7. **Later:** reusable actor instances/retargeting, richer constraint controls and pose blending. Secondary-motion constraints remain deferred; physics needs defined seek/export semantics before implementation.

Current persistence uses envelope v17 for clipping-source visibility, retaining envelope v16 outline sections and explicit open contours, bone/control animation channels from envelope v15, rig v5 canonical-owner locks from envelope v14, group/shared-point and independent-handle weights from rig v4 / envelope v13, and target constraints from rig v3 / envelope v12. Migration preserves legacy closure, poses, target links, separate weights, empty weights and inherited handles without inventing assignments, locks or relationships. Compatibility and undo/reload remain release gates. Static exports consume materialized base artwork; animated rig, outline and visible-clipping export use runtime 1.5's shared evaluator with `rig.pose-v1`, `render.outline-sections-v1` and `render.visible-clipping-v1` capabilities.

Reference behavior: [Spine IK constraints](https://en.esotericsoftware.com/spine-ik-constraints), [Spine Weights view](https://en.esotericsoftware.com/spine-weights), and [Spine Physics constraints](https://us.esotericsoftware.com/spine-physics-constraints). The SVG-specific point/handle and weight-link design above is our own adaptation, not a claim that Spine uses the same data model.
