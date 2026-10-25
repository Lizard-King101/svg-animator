import { BoneWeight } from './objects/armature';
import { editWeightInfluence } from './rig-weight-editing';
import { pointSegmentDistance } from './point-segment-distance';

export type WeightBrushMode = 'add' | 'subtract' | 'set' | 'smooth';
export interface WeightBrushSettings { mode: WeightBrushMode; radius: number; strength: number; value: number; boneId: string; }
export interface WeightBrushPoint { key: string; pathId: string; pointId: string; x: number; y: number; weights: BoneWeight[]; boneIds: string[]; lockedBoneIds?: string[]; }
export interface WeightBrushUpdate { pathId: string; pointId: string; weights: BoneWeight[]; }
export interface BrushPosition { x: number; y: number; }

/** Frozen screen-space geometry and weights make strokes zoom- and event-frequency independent.
 * A point receives its strongest pass once per stroke; another stroke builds on the committed result. */
export class WeightBrushStroke {
    private readonly points: WeightBrushPoint[];
    private readonly coverage = new Map<string, number>();
    private readonly smoothTargets = new Map<string, number>();
    readonly settings: WeightBrushSettings;
    constructor(points: readonly WeightBrushPoint[], settings: WeightBrushSettings) {
        this.points = structuredClone(points) as WeightBrushPoint[];
        this.settings = { ...settings, radius: Math.max(1, settings.radius), strength: Math.max(0, Math.min(1, settings.strength)), value: Math.max(0, Math.min(1, settings.value)) };
        if(settings.mode === 'smooth') {
            const ownerNeighbors = new Map<string, Map<string, { amount: number; falloff: number }>>();
            for(const point of this.points) {
                const neighbors = ownerNeighbors.get(point.key) ?? new Map<string, { amount: number; falloff: number }>();
                ownerNeighbors.set(point.key, neighbors);
                for(const other of this.points) {
                    if(!other.boneIds.includes(settings.boneId)) continue;
                    const falloff = Math.max(0, 1 - Math.hypot(point.x-other.x, point.y-other.y)/this.settings.radius);
                    if(falloff > (neighbors.get(other.key)?.falloff ?? 0)) neighbors.set(other.key, { amount: this.amount(other), falloff });
                }
            }
            for(const [owner, neighbors] of ownerNeighbors) {
                const total = [...neighbors.values()].reduce((sum, entry) => sum+entry.falloff, 0);
                this.smoothTargets.set(owner, total ? [...neighbors.values()].reduce((sum, entry) => sum+entry.amount*entry.falloff, 0)/total : 0);
            }
        }
    }
    sample(from: BrushPosition, to = from): void {
        for(const point of this.points) {
            if(!point.boneIds.includes(this.settings.boneId) || point.lockedBoneIds?.includes(this.settings.boneId)) continue;
            const coverage = Math.max(0, 1 - pointSegmentDistance(point, from, to)/this.settings.radius);
            if(coverage > (this.coverage.get(point.key) ?? 0)) this.coverage.set(point.key, coverage);
        }
    }
    updates(): WeightBrushUpdate[] {
        const updates = new Map<string, WeightBrushUpdate>();
        for(const point of this.points) {
            const strength = (this.coverage.get(point.key) ?? 0)*this.settings.strength;
            if(!strength || updates.has(point.key)) continue;
            const original = this.amount(point), mode = this.settings.mode;
            const value = mode === 'add' ? original+strength : mode === 'subtract' ? original-strength
                : original + ((mode === 'set' ? this.settings.value : this.smoothTargets.get(point.key) ?? original)-original)*strength;
            const weights = editWeightInfluence(point.weights, this.settings.boneId, Math.max(0, Math.min(1, value)), point.boneIds, point.lockedBoneIds);
            if(!sameWeights(weights, point.weights)) updates.set(point.key, { pathId: point.pathId, pointId: point.pointId, weights });
        }
        return [...updates.values()];
    }
    private amount(point: WeightBrushPoint): number { return point.weights.find(entry => entry.boneId === this.settings.boneId)?.weight ?? 0; }
}

function sameWeights(a: readonly BoneWeight[], b: readonly BoneWeight[]): boolean {
    return a.length === b.length && a.every(entry => Math.abs(entry.weight-(b.find(other => other.boneId === entry.boneId)?.weight ?? -1)) < 1e-10);
}
