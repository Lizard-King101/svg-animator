import { Injectable } from "@angular/core";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { ANIMATABLE_PROPERTIES } from "../editor/objects/animation.object";
import { geometryAnimationValues, readAnimationProperty } from "../editor/objects/animation-targets";
import { AnyElement } from "../editor/objects/svg.object";

/** Converts direct canvas edits into animation keyframes at gesture boundaries. */
@Injectable()
export class AnimationGestureService {
    private transformStart?: AnimationTransformDragStart;
    private geometryStart?: AnimationGeometryDragStart;

    constructor(private editor: EditorService, private animation: AnimationPlaybackService) {}

    begin(): void {
        this.captureAnimationTransformDragStart();
        this.captureAnimationGeometryDragStart();
    }

    end(): void {
        const element = this.editor.selectedElement;
        const transformValues = element ? this.transformAnimationValues(element) : undefined;
        const geometryValues = element ? geometryAnimationValues(element) : undefined;
        this.commitAnimationTransformDrag(transformValues);
        this.commitAnimationGeometryDrag(geometryValues);
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

    private commitAnimationTransformDrag(capturedValues?: Record<string, number>) {
        const start = this.transformStart;
        this.transformStart = undefined;
        if(this.animation.mode !== 'animate' || !start || this.editor.selectedElement !== start.element) {
            return;
        }

        const currentValues = capturedValues ?? this.transformAnimationValues(start.element);
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

    private captureAnimationGeometryDragStart(): void {
        const element = this.editor.selectedElement;
        this.geometryStart = this.animation.mode === "animate" && element
            ? { element, values: geometryAnimationValues(element) }
            : undefined;
    }

    private commitAnimationGeometryDrag(capturedValues?: Record<string, number>): void {
        const start = this.geometryStart;
        this.geometryStart = undefined;
        if(this.animation.mode !== "animate" || !start || this.editor.selectedElement !== start.element) return;
        const current = capturedValues ?? geometryAnimationValues(start.element);
        Object.entries(current).forEach(([property, value]) => {
            const baseline = start.values[property];
            if(baseline == null || Math.abs(value - baseline) < 0.0005) return;
            this.animation.upsertKeyframe(start.element, property, "number", value, baseline);
        });
    }

    private transformAnimationValues(element: AnyElement): Record<string, number> {
        const values: Record<string, number> = {};
        ANIMATABLE_PROPERTIES
            .filter((definition) => definition.property.startsWith('transform.'))
            .forEach((definition) => {
                if(definition.property === "transform.originX" && element.transform.originX == null) return;
                if(definition.property === "transform.originY" && element.transform.originY == null) return;
                const value = readAnimationProperty(element, definition.property);
                if(typeof value === 'number' && Number.isFinite(value)) {
                    values[definition.property] = value;
                }
        });
        return values;
    }

}

interface AnimationTransformDragStart { element: AnyElement; values: Record<string, number> }
interface AnimationGeometryDragStart { element: AnyElement; values: Record<string, number> }
