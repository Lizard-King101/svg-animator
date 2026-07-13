import { Injectable } from "@angular/core";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { ANIMATABLE_PROPERTIES } from "../editor/objects/animation.object";
import { pathPointAnimationProperty, readAnimationProperty } from "../editor/objects/animation-targets";
import { Path } from "../editor/objects/elements/path.object";
import { gradientAnimationProperties } from "../editor/objects/paint.object";
import { AnyElement } from "../editor/objects/svg.object";

/** Converts direct canvas edits into animation keyframes at gesture boundaries. */
@Injectable()
export class AnimationGestureService {
    private transformStart?: AnimationTransformDragStart;
    private pathPointStart?: AnimationPathPointDragStart;
    private gradientStart?: AnimationGradientDragStart;

    constructor(private editor: EditorService, private animation: AnimationPlaybackService) {}

    begin(): void {
        this.captureAnimationTransformDragStart();
        this.captureAnimationPathPointDragStart();
        this.captureAnimationGradientDragStart();
    }

    end(): void {
        this.commitAnimationTransformDrag();
        this.commitAnimationPathPointDrag();
        this.commitAnimationGradientDrag();
    }

    private captureAnimationTransformDragStart() {
        if(this.animation.mode !== 'animate' || !this.editor.selectedElement) {
            this.transformStart = undefined;
            return;
        }

        this.transformStart = {
            element: this.editor.selectedElement,
            values: this.transformAnimationValues(this.editor.selectedElement),
        };
    }

    private commitAnimationTransformDrag() {
        const start = this.transformStart;
        this.transformStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.element) {
            return;
        }

        if(start.element instanceof Path && this.pathPointStart?.path === start.element && this.pathPointValuesChanged(this.pathPointStart)) {
            return;
        }

        const currentValues = this.transformAnimationValues(start.element);
        ANIMATABLE_PROPERTIES
            .filter((definition) => definition.property.startsWith('transform.'))
            .forEach((definition) => {
                const startValue = start.values[definition.property];
                const currentValue = currentValues[definition.property];
                if(startValue == null || currentValue == null || Math.abs(currentValue - startValue) < 0.0005) {
                    return;
                }

                this.animation.upsertKeyframe(start.element, definition.property, definition.valueType, currentValue, startValue);
            });
    }

    private captureAnimationPathPointDragStart() {
        if(this.animation.mode !== 'animate' || !(this.editor.selectedElement instanceof Path)) {
            this.pathPointStart = undefined;
            return;
        }

        this.pathPointStart = {
            path: this.editor.selectedElement,
            values: this.pathPointAnimationValues(this.editor.selectedElement),
        };
    }

    private commitAnimationPathPointDrag() {
        const start = this.pathPointStart;
        this.pathPointStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.path) {
            return;
        }

        const currentValues = this.pathPointAnimationValues(start.path);
        const changed: Array<{ id: string; axis: 'x' | 'y'; value: number; baseline: number }> = [];
        Object.entries(currentValues).forEach(([id, current]) => {
            const baseline = start.values[id];
            if(!baseline) {
                return;
            }

            if(Math.abs(current.x - baseline.x) >= 0.0005) {
                changed.push({ id, axis: 'x', value: current.x, baseline: baseline.x });
            }

            if(Math.abs(current.y - baseline.y) >= 0.0005) {
                changed.push({ id, axis: 'y', value: current.y, baseline: baseline.y });
            }
        });

        if(changed.length === 0) {
            return;
        }

        changed.forEach((change) => {
            this.animation.upsertKeyframe(
                start.path,
                pathPointAnimationProperty(change.id, change.axis),
                'number',
                change.value,
                change.baseline
            );
        });
    }

    private transformAnimationValues(element: AnyElement): Record<string, number> {
        const values: Record<string, number> = {};
        ANIMATABLE_PROPERTIES
            .filter((definition) => definition.property.startsWith('transform.'))
            .forEach((definition) => {
                const value = readAnimationProperty(element, definition.property);
                if(typeof value === 'number' && Number.isFinite(value)) {
                    values[definition.property] = value;
                }
        });
        return values;
    }

    private pathPointValuesChanged(start: AnimationPathPointDragStart): boolean {
        const currentValues = this.pathPointAnimationValues(start.path);
        return Object.entries(currentValues).some(([id, current]) => {
            const baseline = start.values[id];
            return !!baseline && (
                Math.abs(current.x - baseline.x) >= 0.0005 ||
                Math.abs(current.y - baseline.y) >= 0.0005
            );
        });
    }

    private pathPointAnimationValues(path: Path): Record<string, { x: number; y: number }> {
        const values: Record<string, { x: number; y: number }> = {};
        path.pathPoints().forEach((point) => {
            values[point.id] = { x: point.x, y: point.y };
        });
        return values;
    }

    private captureAnimationGradientDragStart() {
        const element = this.editor.selectedElement;
        if(this.animation.mode !== 'animate' || !element) {
            this.gradientStart = undefined;
            return;
        }
        const values: Record<string, number> = {};
        gradientAnimationProperties(element.settings as Record<string, unknown>)
            .filter((definition) => !definition.property.includes('.stops.'))
            .forEach((definition) => {
                const value = readAnimationProperty(element, definition.property);
                if(typeof value === 'number') values[definition.property] = value;
            });
        this.gradientStart = Object.keys(values).length ? { element, values } : undefined;
    }

    private commitAnimationGradientDrag() {
        const start = this.gradientStart;
        this.gradientStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.element) return;
        const changes = Object.entries(start.values).flatMap(([property, baseline]) => {
            const value = readAnimationProperty(start.element, property);
            if(typeof value === 'number' && Math.abs(value - baseline) >= 0.0005) {
                return [{ property, baseline, value }];
            }
            return [];
        });
        changes.forEach(({ property, baseline, value }) => this.animation.upsertKeyframe(start.element, property, 'number', value, baseline));
    }
}

interface AnimationTransformDragStart { element: AnyElement; values: Record<string, number> }
interface AnimationPathPointDragStart { path: Path; values: Record<string, { x: number; y: number }> }
interface AnimationGradientDragStart { element: AnyElement; values: Record<string, number> }
