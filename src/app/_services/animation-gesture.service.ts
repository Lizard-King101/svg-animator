import { Injectable } from "@angular/core";
import { AnimationPlaybackService } from "./animation-playback.service";
import { EditorService } from "./editor.service";
import { ANIMATABLE_PROPERTIES } from "../editor/objects/animation.object";
import { geometryAnimationChanges, geometryAnimationValues, readAnimationProperty } from "../editor/objects/animation-targets";
import { AnyElement } from "../editor/objects/svg.object";

/** Converts direct canvas edits into animation keyframes at gesture boundaries. */
@Injectable()
export class AnimationGestureService {
    private starts: AnimationGestureStart[] = [];

    constructor(private editor: EditorService, private animation: AnimationPlaybackService) {}

    begin(): void {
        const selected = this.editor.selectedElements ?? (this.editor.selectedElement ? [this.editor.selectedElement] : []);
        this.starts = this.animation.mode === 'animate' ? selected.map((element) => ({
            element, transform: this.transformAnimationValues(element), geometry: geometryAnimationValues(element),
        })) : [];
    }

    cancel(): void { this.starts = []; }

    end(): void {
        const starts = this.starts;
        this.starts = [];
        if(this.animation.mode !== 'animate') return;
        const selected = this.editor.selectedElements ?? (this.editor.selectedElement ? [this.editor.selectedElement] : []);
        // Each keyframe upsert restores/reapplies the preview. Capture every
        // target first so writing one track cannot erase another target's edit.
        const captures = starts.filter((start) => selected.includes(start.element)).map((start) => ({
            ...start, currentTransform: this.transformAnimationValues(start.element), currentGeometry: geometryAnimationValues(start.element),
        }));
        captures.forEach((start) => {
            ANIMATABLE_PROPERTIES.filter((definition) => definition.property.startsWith('transform.')).forEach((definition) => {
                const baseline = start.transform[definition.property];
                const value = start.currentTransform[definition.property];
                if(baseline == null || value == null || Math.abs(value - baseline) < 0.0005) return;
                this.animation.upsertKeyframe(start.element, definition.property, definition.valueType, value, baseline);
            });
            geometryAnimationChanges(start.element, start.geometry, start.currentGeometry).forEach(({ property, value, baseline }) => {
                this.animation.upsertKeyframe(start.element, property, 'number', value, baseline);
            });
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

interface AnimationGestureStart {
    element: AnyElement;
    transform: Record<string, number>;
    geometry: Record<string, number>;
}
