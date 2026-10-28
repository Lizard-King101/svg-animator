import type { RigSceneOptions } from './rig-scene';

type LabWorkload = { id: string; label: string } & (
    { kind: 'outline'; rigs: number; segments: number } | { kind: 'scene'; options: RigSceneOptions });

/** Shared by the selector, report and browser automation. Existing IDs stay stable. */
export const labWorkloads: readonly LabWorkload[] = [
    ...[1, 3, 10].map(rigs => ({ id: `${rigs},4`, label: `${rigs} outline rig${rigs === 1 ? '' : 's'}`, kind: 'outline' as const, rigs, segments: 4 })),
    { id: '10,40', label: '10 dense outline rigs', kind: 'outline', rigs: 10, segments: 40 },
    ...[1, 3, 10].map(rigs => ({ id: `rig-scene,${rigs}`, label: `${rigs} animated scene rig${rigs === 1 ? '' : 's'} · baseline`, kind: 'scene' as const, options: { rigs } })),
    { id: 'scene-geometry-24', label: 'Geometry · 10 rigs, 24 vertices/path', kind: 'scene', options: { rigs: 10, subdivisions: 4 } },
    { id: 'scene-geometry-48', label: 'Geometry · 10 rigs, 48 vertices/path', kind: 'scene', options: { rigs: 10, subdivisions: 8 } },
    { id: 'scene-layers-8', label: 'Layers · 10 rigs, 8 paths/rig', kind: 'scene', options: { rigs: 10, pathsPerRig: 8 } },
    { id: 'scene-layers-24', label: 'Layers · 10 rigs, 24 paths/rig', kind: 'scene', options: { rigs: 10, pathsPerRig: 24 } },
    { id: 'scene-combined', label: 'Combined · 10 rigs, 12 paths/rig, 24 vertices/path', kind: 'scene', options: { rigs: 10, pathsPerRig: 12, subdivisions: 4 } },
    { id: 'scene-static-0', label: 'Static surroundings · 1 of 10 rigs moving', kind: 'scene', options: { rigs: 10, moving: 1 } },
    { id: 'scene-static-500', label: 'Static surroundings · 1 moving rig + 500 background layers', kind: 'scene', options: { rigs: 10, moving: 1, staticLayers: 500 } },
    { id: 'scene-static-2000', label: 'Static surroundings · 1 moving rig + 2,000 background layers', kind: 'scene', options: { rigs: 10, moving: 1, staticLayers: 2000 } },
];

export function labWorkload(id: string): LabWorkload {
    const workload = labWorkloads.find(workload => workload.id === id);
    if(!workload) throw new Error('Invalid workload.');
    return workload;
}
