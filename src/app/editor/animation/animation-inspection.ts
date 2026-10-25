import { AnimationEvaluationPlan } from './animation-evaluation-plan';
import { findAnimationTarget, writeAnimationProperty } from '../objects/animation-targets';
import { findElementChain, resolvedOrigin } from '../objects/element-bounds';
import { combinedMotionAdjustedMatrixFor } from '../objects/motion-path.object';
import { SVG } from '../objects/svg.object';
import { applyMatrix } from '../objects/transform.object';
import { buildSVGMarkup } from '../svg-markup';
import { captureGeometrySnapshot, restoreGeometrySnapshot } from '../objects/element-geometry';

export interface InspectionPoint { x: number; y: number; time: number; }
export interface MotionTrail { id: string; segments: InspectionPoint[][]; ticks: InspectionPoint[]; }
export interface OnionSkin { time: number; direction: 'past' | 'future'; image: string; opacity: number; }

/** Bounded samples in document time; do not wrap at loop boundaries. */
export function onionTimes(time: number, duration: number, step: number): number[] {
    return [-2, -1, 1, 2].map(offset => time + offset * step)
        .filter(value => value >= 0 && value <= duration);
}

/** Owns a detached model. Sampling never writes into the active artwork or its renderer. */
export class AnimationInspectionSnapshot {
    private readonly plan: AnimationEvaluationPlan;
    private readonly baselines;
    constructor(readonly document: SVG) {
        this.plan = new AnimationEvaluationPlan(document.animation, document.elements);
        this.baselines = [...this.plan.targetMap.values()].map(target => ({
            target, geometry: captureGeometrySnapshot(target), transform: { ...target.transform },
        }));
    }

    private at(time: number): void {
        // Frame-position adapters can also move points, origins and gradients.
        // Start each sample from the same geometry, including random/backward seeks.
        this.baselines.forEach(base => {
            restoreGeometrySnapshot(base.target, base.geometry);
            base.target.transform = { ...base.transform };
        });
        this.plan.evaluate(time).forEach(value => {
            const target = this.plan.targetMap.get(value.targetId);
            if(value.applied && target) writeAnimationProperty(target, value.property, value.value);
        });
    }

    skins(time: number, step: number, selectedIds: readonly string[] = []): OnionSkin[] {
        const subjects = new Set(selectedIds.length ? selectedIds : this.plan.tracks.map(track => track.targetId));
        const kept = new Set<string>();
        this.plan.targetMap.forEach(target => {
            const chain = findElementChain(this.document.elements, target) ?? [];
            if(chain.some(element => subjects.has(element.id))) chain.forEach(element => kept.add(element.id));
        });
        return onionTimes(time, this.document.animation.duration, step).map(sampleTime => {
            this.at(sampleTime);
            // Compute transforms with the full scene first, retaining automatic origins,
            // clipping and motion references; hide unrelated artwork only in the image.
            const root = new DOMParser().parseFromString(buildSVGMarkup(this.document), 'image/svg+xml');
            root.querySelectorAll('[id]').forEach(node => {
                const id = node.getAttribute('id')!;
                if(this.plan.targetMap.has(id) && !kept.has(id) && !node.closest('defs')) node.remove();
            });
            return { time: sampleTime, direction: sampleTime < time ? 'past' : 'future',
                opacity: Math.abs(sampleTime - time) > step * 1.5 ? 0.10 : 0.20,
                // An isolated SVG image keeps sampled IDs/gradients/clips out of the live DOM.
                image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}` };
        });
    }

    origins(time: number, ids: readonly string[]): Map<string, InspectionPoint> {
        this.at(time);
        const result = new Map<string, InspectionPoint>();
        ids.forEach(id => {
            const target = findAnimationTarget(this.document.elements, id);
            if(!target || !findElementChain(this.document.elements, target)?.every(element => element.visible && element.opacity > 0)) return;
            const origin = resolvedOrigin(target);
            const point = applyMatrix(combinedMotionAdjustedMatrixFor(this.document, target), origin.x, origin.y);
            if(Number.isFinite(point.x) && Number.isFinite(point.y)) result.set(id, { ...point, time });
        });
        return result;
    }

    trails(ids: readonly string[]): MotionTrail[] {
        const trails = ids.slice(0, 8).map(id => ({ id, segments: [] as InspectionPoint[][], ticks: [] as InspectionPoint[] }));
        const active = new Map<string, InspectionPoint[]>();
        for(let index = 0; index <= 60; index++) {
            const points = this.origins(this.document.animation.duration * index / 60, trails.map(trail => trail.id));
            trails.forEach(trail => {
                const point = points.get(trail.id);
                if(!point) { active.delete(trail.id); return; }
                let segment = active.get(trail.id);
                if(!segment) { segment = []; trail.segments.push(segment); active.set(trail.id, segment); }
                segment.push(point);
                if(index % 10 === 0) trail.ticks.push(point);
            });
        }
        return trails.filter(trail => trail.segments.some(segment => segment.some(point =>
            Math.hypot(point.x - segment[0].x, point.y - segment[0].y) > 0.001)));
    }
}
