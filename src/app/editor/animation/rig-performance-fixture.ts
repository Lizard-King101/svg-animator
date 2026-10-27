import { EditorService } from '../../_services/editor.service';
import { Armature } from '../objects/armature';
import { SVG } from '../objects/svg.object';
import { Group } from '../objects/elements/group.object';
import { Path } from '../objects/elements/path.object';
import { Shape } from '../objects/elements/shape.object';
import { Line } from '../objects/line.object';
import { Point } from '../objects/point.object';
import { identityMatrix } from '../objects/transform.object';
import { createPathBinding } from '../rig-binding';
import { DocumentRigEvaluationPlan } from '../rig-evaluation';
import { fullOutlineSections } from '../../../../packages/runtime/src/outline';
import { pathOutlineContours } from '../path-outline';

/** Synthetic, shareable workload; contains no artwork or IDs from private projects.
 * Each character has a moving root, dependent double IK, weighted curves, outline,
 * nested clipped artwork and a rigid attachment. Density and static layers vary independently.
 */
export function createRigPerformanceFixture(editor: EditorService, options: { rigs?: number; moving?: number; segments?: number; staticLayers?: number } = {}): SVG {
    const count = options.rigs ?? 1, segments = options.segments ?? 4;
    const svg = new SVG(editor, { width: 1000, height: 800, pos: new Point(0, 0), name: 'Rig performance fixture' });
    svg.animation.duration = 3; svg.animation.loop = true;
    for(let index = 0; index < count; index++) {
        const prefix = `rig-${index}`, x = 40 + index % 4 * 240, y = 90 + Math.floor(index / 4) * 220;
        const group = new Group(editor), nested = new Group(editor), paths = [new Path(editor), new Path(editor)];
        const clip = new Shape(editor, { type: 'rectangle', position: new Point(x - 30, y - 100), width: 230, height: 200 });
        const attachment = new Shape(editor, { type: 'rectangle', position: new Point(x + 80, y), width: 12, height: 8 });
        group.id = `${prefix}-group`; nested.id = `${prefix}-nested`; clip.id = `${prefix}-clip`; attachment.id = `${prefix}-attachment`;
        for(const element of [group, nested, clip, attachment, ...paths]) element.transform.originX = element.transform.originY = 0;
        paths.forEach((path, pathIndex) => {
            path.id = `${prefix}-path-${pathIndex}`;
            path.lines = Array.from({ length: segments }, (_, segment) => {
                const start = x + segment * 150 / segments, end = x + (segment + 1) * 150 / segments, height = y - pathIndex * 8;
                return new Line(editor, { type: 'bezier', points: [new Point(start, height), new Point(end, height)],
                    controlStart: new Point(start + 15 / segments, height - 5), controlEnd: new Point(end - 15 / segments, height + 5) });
            });
            path.settings.stroke_width = 5;
        });
        paths[1].outlineSections = fullOutlineSections(pathOutlineContours(paths[1]));
        nested.elements = [...paths, attachment]; group.elements = [clip, nested]; group.clipElementId = clip.id; svg.elements.push(group);
        const rig: Armature = { id: prefix, name: index === 0 && count === 10 ? 'Scene rig' : `Character ${index + 1}`, bones: [
            { id: 'root', name: 'Root', kind: 'point', parentId: null, x, y, angle: 0, length: 0, pose: 0 },
            { id: 'upper', name: 'Upper', parentId: 'root', x: 0, y: 0, angle: 0, length: 80, pose: 0 },
            { id: 'lower', name: 'Lower', parentId: 'upper', x: 80, y: 0, angle: 0, length: 70, pose: 0 },
            { id: 'flex-upper', name: 'Flex upper', parentId: 'upper', x: 10, y: -5, angle: 0, length: 60, pose: 0 },
            { id: 'flex-lower', name: 'Flex lower', parentId: 'flex-upper', x: 60, y: 0, angle: 0, length: 60, pose: 0 },
            { id: 'joint', name: 'Joint target', kind: 'point', parentId: 'lower', x: 10, y: 0, angle: 0, length: 0, pose: 0 },
            { id: 'target', name: 'Target', kind: 'point', parentId: 'root', x: 120, y: 25, angle: 0, length: 0, pose: 0 },
        ], constraints: [
            { id: 'flex', name: 'Flex IK', type: 'two-bone-ik', upperBoneId: 'flex-upper', lowerBoneId: 'flex-lower', targetBoneId: 'joint', bend: -1, enabled: true },
            { id: 'arm', name: 'Arm IK', type: 'two-bone-ik', upperBoneId: 'upper', lowerBoneId: 'lower', targetBoneId: 'target', bend: 1, enabled: true },
        ], bindings: paths.map((path, i) => createPathBinding(svg, path, i ? 'flex-upper' : 'upper')),
        attachments: [{ elementId: attachment.id, boneId: 'lower', parentMatrix: identityMatrix(), worldMatrix: identityMatrix(), restTransform: { ...attachment.transform } }] };
        for(const binding of rig.bindings) for(const point of binding.points) if(point.id === point.anchorId) {
            point.weights = [{ boneId: 'upper', weight: .3 }, { boneId: binding === rig.bindings[0] ? 'lower' : 'flex-lower', weight: .7 }];
        }
        svg.rigs.armatures.push(rig);
        if(index < (options.moving ?? count)) for(const [bone, field, amplitude] of [['root', 'poseX', 12], ['root', 'poseY', 5], ['target', 'poseX', -25], ['target', 'poseY', 40]] as const) {
            svg.animation.tracks.push({ id: `${prefix}-${bone}-${field}`, targetId: prefix, property: `bones.${bone}.${field}`, valueType: 'number',
                keyframes: [0, .75, 1.5, 2.25, 3].map((time, key) => ({ id: `${prefix}-${bone}-${field}-${key}`, time, value: Math.sin(time / 3 * Math.PI * 2) * amplitude, easing: { type: 'ease-in-out' } })) });
        }
    }
    for(let index = 0; index < (options.staticLayers ?? 0); index++) svg.elements.push(new Shape(editor, { type: 'rectangle', position: new Point(index % 40 * 25, Math.floor(index / 40) * 12), width: 10, height: 6 }));
    new DocumentRigEvaluationPlan(svg).apply();
    return svg;
}
