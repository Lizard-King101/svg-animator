import type { RuntimeSceneTargetV1 } from '../../packages/runtime/src/contracts';

const transform = { translateX: 0, translateY: 0, scaleX: 1, scaleY: 1, rotation: 0, originX: 0, originY: 0, autoOrigin: false };
export function layer(id: string, parentId: string | null, type: RuntimeSceneTargetV1['type'] = 'rectangle'): RuntimeSceneTargetV1 {
    return { id, parentId, type, visible: true, opacity: 1, transform: { ...transform },
        motion: { pathId: null, progress: 0, offsetX: 0, offsetY: 0, rotateToPath: false, offsetAngle: 0 },
        geometry: { x: 10, y: 10, width: 80, height: 80 }, paints: { fill: { kind: 'solid', color: '#2277cc', opacity: 1 } } };
}
const group = (id: string, parentId: string | null, clip?: string) => ({ ...layer(id, parentId, 'group'), paints: {},
    ...(clip ? { clipping: { clipElementId: clip, clipPathId: `clip-${id}`, sourceVisibility: true as const } } : {}) });
function path(id: string, parentId: string | null, polygons: number[][][], fillRule: 'nonzero' | 'evenodd' = 'nonzero'): RuntimeSceneTargetV1 {
    const target = layer(id, parentId, 'path');
    target.path = { fillRule, drawProgress: 1, rounded: false, contours: polygons.map((polygon, c) => {
        const points = polygon.map(([x, y], p) => ({ id: `${id}:${c}:${p}`, x, y }));
        return { id: `${id}:${c}`, closed: true, lines: points.map((point, p) => ({ id: `${id}:${c}:edge:${p}`, type: 'line', points: [point, points[(p + 1) % points.length]] })) };
    }) }; return target;
}
export interface SceneCase { name: string; targets: RuntimeSceneTargetV1[]; svg: string; eligible: boolean; }
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${body}</svg>`;
export function sceneCases(): SceneCase[] {
    const outer = group('outer', null, 'mask'), mask = layer('mask', 'outer'); mask.visible = false;
    outer.transform = { ...transform, translateX: 8, translateY: 5, rotation: 10, originX: 50, originY: 50 };
    const inner = group('inner', 'outer', 'diamond'); inner.transform = { ...transform, translateX: 10, scaleX: .8 };
    const diamond = path('diamond', 'inner', [[[5, 50], [50, 5], [95, 50], [50, 95]]]); diamond.visible = false;
    const blue = layer('blue', 'inner'); blue.geometry = { x: -10, y: -10, width: 140, height: 140 };
    const red = layer('red', 'inner'); red.geometry = { x: 40, y: 0, width: 60, height: 120 }; red.paints.fill = { kind: 'solid', color: '#cc3322', opacity: .5 };
    const tail = layer('tail', null); tail.geometry = { x: 100, y: 110, width: 20, height: 12 }; tail.paints.fill = { kind: 'solid', color: '#33cc44', opacity: 1 };
    const ringGroup = group('ringGroup', null, 'ring');
    const ring = path('ring', 'ringGroup', [[[8, 8], [120, 8], [120, 120], [8, 120]], [[38, 38], [90, 38], [90, 90], [38, 90]]], 'evenodd'); ring.visible = false;
    const ringArt = layer('ringArt', 'ringGroup'); ringArt.geometry = { x: 0, y: 0, width: 128, height: 128 };
    const visibleGroup = group('visibleGroup', null, 'visibleMask'), visibleMask = layer('visibleMask', 'visibleGroup');
    visibleMask.geometry = { x: 18, y: 18, width: 92, height: 92 }; visibleMask.paints.fill = { kind: 'solid', color: '#ffcc33', opacity: 1 };
    visibleMask.paints.stroke = { kind: 'solid', color: '#cc2244', opacity: 1 }; visibleMask.stroke = { width: 10, alignment: 'center', dasharray: [], dashoffset: 0, lineJoin: 'miter' };
    const visibleArt = layer('visibleArt', 'visibleGroup'); visibleArt.geometry = { x: 50, y: 0, width: 90, height: 128 };
    const reflected = group('reflection', null, 'reflection-mask'); reflected.transform = { ...transform, translateX: 120, scaleX: -1, scaleY: .8, translateY: 10 };
    const reflectionMask = path('reflection-mask', 'reflection', [[[8, 8], [108, 8], [108, 38], [38, 38], [38, 108], [8, 108]]]); reflectionMask.visible = false;
    const reflectionArt = layer('reflection-art', 'reflection'); reflectionArt.geometry = { x: 0, y: 0, width: 128, height: 128 };
    const transparent = layer('transparent', null); transparent.opacity = .5;
    const behind = layer('behind', null); behind.geometry.x = 40; behind.paints.fill = { kind: 'solid', color: '#cc3322', opacity: .5 };
    const isolated = group('isolated', null); isolated.opacity = .5;
    const a = layer('a', 'isolated'), b = layer('b', 'isolated'); b.geometry.x = 40;
    return [
        { name: 'nested-transformed-clips', eligible: true, targets: [outer, mask, inner, diamond, blue, red, tail], svg: svg('<defs><clipPath id="a"><rect x="10" y="10" width="80" height="80"/></clipPath><clipPath id="b"><path d="M5 50L50 5L95 50L50 95Z"/></clipPath></defs><g transform="translate(8 5) translate(50 50) rotate(10) translate(-50 -50)"><g clip-path="url(#a)"><g transform="translate(10 0) scale(.8 1)"><g clip-path="url(#b)"><rect x="-10" y="-10" width="140" height="140" fill="#2277cc"/><rect x="40" width="60" height="120" fill="#cc3322" fill-opacity=".5"/></g></g></g></g><rect x="100" y="110" width="20" height="12" fill="#33cc44"/>') },
        { name: 'even-odd-clip-hole', eligible: true, targets: [ringGroup, ring, ringArt], svg: svg('<defs><clipPath id="ring"><path clip-rule="evenodd" d="M8 8H120V120H8Z M38 38H90V90H38Z"/></clipPath></defs><rect width="128" height="128" fill="#2277cc" clip-path="url(#ring)"/>') },
        { name: 'visible-source-fill-content-stroke-order', eligible: true, targets: [visibleGroup, visibleArt, visibleMask], svg: svg('<defs><clipPath id="mask"><rect x="18" y="18" width="92" height="92"/></clipPath></defs><rect x="18" y="18" width="92" height="92" fill="#ffcc33"/><rect x="50" width="90" height="128" fill="#2277cc" clip-path="url(#mask)"/><rect x="18" y="18" width="92" height="92" fill="none" stroke="#cc2244" stroke-width="10"/>') },
        { name: 'reflected-concave-clip', eligible: true, targets: [reflected, reflectionMask, reflectionArt], svg: svg('<defs><clipPath id="l"><path d="M8 8H108V38H38V108H8Z"/></clipPath></defs><g transform="translate(120 10) scale(-1 .8)"><rect width="128" height="128" fill="#2277cc" clip-path="url(#l)"/></g>') },
        { name: 'ordered-transparent-layers', eligible: true, targets: [transparent, behind], svg: svg('<rect x="10" y="10" width="80" height="80" fill="#2277cc" opacity=".5"/><rect x="40" y="10" width="80" height="80" fill="#cc3322" fill-opacity=".5"/>') },
        { name: 'group-opacity-falls-back', eligible: false, targets: [isolated, a, b], svg: svg('<g opacity=".5"><rect x="10" y="10" width="80" height="80" fill="#2277cc"/><rect x="40" y="10" width="80" height="80" fill="#2277cc"/></g>') },
    ];
}
