import { NgFor, NgIf, NgStyle } from "@angular/common";
import { Component, HostListener } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { FaIconComponent } from "@fortawesome/angular-fontawesome";
import { AnimationPlaybackService } from "../../_services/animation-playback.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { BoolAttribute } from "../attributes/bool/bool.component";
import { ColorAttribute } from "../attributes/color/color.component";
import { RangeAttribute } from "../attributes/range/range.component";
import { SelectAttribut } from "../attributes/select/select.component";
import { TextAttribute } from "../attributes/text/text.component";
import { ANIMATABLE_PROPERTIES, AnimatablePropertyDefinition, createAnimationColorValue } from "../../editor/objects/animation.object";
import { Color } from "../../editor/objects/color.object";
import { pinTransformOrigin, resolvedOrigin } from "../../editor/objects/element-bounds";
import { ElementAttribute } from "../../editor/objects/elements/element";
import { Path } from "../../editor/objects/elements/path.object";
import { Shape } from "../../editor/objects/elements/shape.object";
import { convertGradientUnits } from "../../editor/objects/gradient-geometry";
import { createDefaultGradient, GradientKind, GradientPaint, GradientStop, isGradientPaint } from "../../editor/objects/paint.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { readAnimationProperty } from "../../editor/objects/animation-targets";

@Component({
    selector: "app-properties-panel",
    standalone: true,
    imports: [FormsModule, NgFor, NgIf, NgStyle, FaIconComponent, BoolAttribute, ColorAttribute, RangeAttribute, SelectAttribut, TextAttribute],
    templateUrl: "properties-panel.component.html",
    styles: [":host { display: contents; }"],
})
export class PropertiesPanelComponent {
    readonly ANIMATABLE_PROPERTIES = ANIMATABLE_PROPERTIES;
    openGradientStopsKey?: string;
    gradientStopsPopoverPosition?: { left: number; top: number };

    constructor(public editor: EditorService, public animation: AnimationPlaybackService, private mutations: DocumentMutationService) {}

    @HostListener("document:click")
    closeGradientStopsPopover(): void {
        this.openGradientStopsKey = undefined;
        this.gradientStopsPopoverPosition = undefined;
    }

    private scheduleAttributeSnapshot(): void { this.mutations.schedule(); }

    asShape(element: AnyElement | undefined): Shape | null {
        return element instanceof Shape ? element : null;
    }

    asPath(element: AnyElement | undefined): Path | null {
        return element instanceof Path ? element : null;
    }

    /** Bridge for template dynamic-key access on the now-typed settings object. */
    settingsOf(element: AnyElement | undefined): Record<string, any> {
        return (element?.settings ?? {}) as Record<string, any>;
    }

    asGradientPaint(value: unknown): GradientPaint | null {
        return isGradientPaint(value) ? value : null;
    }

    toggleGradientStopsPopover(element: AnyElement | undefined, key: string, event: MouseEvent) {
        event.stopPropagation();
        if(!element) return;
        const rowKey = `${element.id}:${key}`;
        if(this.openGradientStopsKey === rowKey) {
            this.closeGradientStopsPopover();
            return;
        }
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.gradientStopsPopoverPosition = this.popoverPosition(rect, 286, 440);
        this.openGradientStopsKey = rowKey;
    }

    gradientStopsPopoverOpen(element: AnyElement | undefined, key: string): boolean {
        return !!element && this.openGradientStopsKey === `${element.id}:${key}`;
    }

    gradientStopsPopoverStyle(): Record<string, string> {
        const position = this.gradientStopsPopoverPosition;
        return position ? { left: `${position.left}px`, top: `${position.top}px` } : {};
    }

    selectGradientPaint(key: string) {
        if(key === "fill" || key === "stroke") this.editor.selectedGradientPaintKey = key;
    }

    enableGradientPaint(element: AnyElement | undefined, key: string, kind: GradientKind = "linear-gradient") {
        if(!element || (key !== "fill" && key !== "stroke") || this.animation.mode === "animate") return;
        const gradient = createDefaultGradient(this.editor.ID, kind);
        const current = this.settingsOf(element)[key];
        if(current instanceof Color) {
            gradient.stops[0].color = new Color(current.serialized);
            gradient.stops[1].color = new Color(current.serialized);
        }
        this.settingsOf(element)[key] = gradient;
        this.selectGradientPaint(key);
        if(element instanceof Path && key === "fill") element.settings.fill_enabled = true;
        this.scheduleAttributeSnapshot();
    }

    useSolidPaint(element: AnyElement | undefined, key: string, gradient: GradientPaint) {
        if(!element || (key !== "fill" && key !== "stroke") || this.animation.mode === "animate") return;
        this.settingsOf(element)[key] = gradient.stops[0] ? new Color(gradient.stops[0].color.serialized) : null;
        this.removeGradientTracks(element, `settings.${key}.gradient.`);
        this.scheduleAttributeSnapshot();
    }

    setGradientKind(element: AnyElement | undefined, key: string, gradient: GradientPaint, kind: GradientKind) {
        if(!element || this.animation.mode === "animate" || gradient.type === kind) return;
        const replacement = createDefaultGradient(gradient.id, kind);
        replacement.stops = gradient.stops;
        replacement.units = gradient.units;
        replacement.spreadMethod = gradient.spreadMethod;
        replacement.transform = gradient.transform;
        this.settingsOf(element)[key] = replacement;
        this.removeGradientTracks(element, `settings.${key}.gradient.`);
        this.scheduleAttributeSnapshot();
    }

    setGradientUnits(element: AnyElement | undefined, gradient: GradientPaint, units: GradientPaint["units"]) {
        if(!element || this.animation.mode === "animate") return;
        if(convertGradientUnits(element, gradient, units)) this.scheduleAttributeSnapshot();
    }

    setGradientMeta(gradient: GradientPaint, field: "spreadMethod", value: GradientPaint["spreadMethod"]) {
        if(this.animation.mode === "animate") return;
        if(field === "spreadMethod" && (value === "pad" || value === "reflect" || value === "repeat")) gradient.spreadMethod = value;
        this.scheduleAttributeSnapshot();
    }

    private popoverPosition(rect: DOMRect, width: number, preferredHeight: number): { left: number; top: number } {
        const margin = 8;
        const height = Math.min(preferredHeight, window.innerHeight - margin * 2);
        const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
        const below = rect.bottom + 4;
        const top = below + height <= window.innerHeight - margin
            ? below
            : Math.max(margin, rect.top - height - 4);
        return { left, top };
    }

    setGradientStopValue(element: AnyElement | undefined, key: string, stop: GradientStop, field: "offset" | "opacity" | "color", value: unknown) {
        if(!element) return;
        const property = `settings.${key}.gradient.stops.${stop.id}.${field}`;
        if(this.animation.mode === "animate") {
            this.animation.setAnimatedPropertyValue(element, property, field === "color" ? "color" : "number", field === "color" ? this.normalizeAnimationValue(value, {
                property, label: "Gradient Stop", valueType: "color", group: "style", mvp: true,
            }) : value);
            this.scheduleAttributeSnapshot();
            return;
        }
        if(field === "color" && value instanceof Color) {
            stop.color = value;
            stop.opacity = value.alpha;
        }
        if(field !== "color") {
            const numeric = typeof value === "number" ? value : Number(value);
            if(Number.isFinite(numeric)) stop[field] = Math.max(0, Math.min(1, numeric));
        }
        this.scheduleAttributeSnapshot();
    }

    addGradientStop(gradient: GradientPaint) {
        if(this.animation.mode === "animate") return;
        const last = gradient.stops[gradient.stops.length - 1];
        gradient.stops.push({ id: this.editor.ID, offset: 0.5, color: new Color(last?.color.serialized ?? "#ffffff"), opacity: last?.color.alpha ?? 1 });
        gradient.stops.sort((a, b) => a.offset - b.offset);
        this.scheduleAttributeSnapshot();
    }

    removeGradientStop(element: AnyElement | undefined, key: string, gradient: GradientPaint, stop: GradientStop) {
        if(!element || this.animation.mode === "animate" || gradient.stops.length <= 2) return;
        gradient.stops = gradient.stops.filter((candidate) => candidate !== stop);
        this.removeGradientTracks(element, `settings.${key}.gradient.stops.${stop.id}.`);
        this.scheduleAttributeSnapshot();
    }

    private removeGradientTracks(element: AnyElement, prefix: string) {
        const animation = this.editor.selectedSVG?.animation;
        if(animation) animation.tracks = animation.tracks.filter((track) => track.targetId !== element.id || !track.property.startsWith(prefix));
    }

    handleAttributeChange(element: AnyElement | undefined, attr: ElementAttribute, value: unknown) {
        if(!element) {
            return;
        }

        const property = `settings.${attr.output}`;
        const definition = this.ANIMATABLE_PROPERTIES.find((candidate) => candidate.property === property);
        if(this.animation.mode === 'animate' && definition && this.animationPropertySupported(element, definition)) {
            this.animation.setAnimatedPropertyValue(element, property, definition.valueType, this.normalizeAnimationValue(value, definition));
            this.scheduleAttributeSnapshot();
            return;
        }

        this.settingsOf(element)[attr.output] = value;
        this.scheduleAttributeSnapshot();
    }

    transformValue(element: AnyElement | undefined, field: TransformField): number {
        if(!element) {
            return 0;
        }

        if(field === 'originX' || field === 'originY') {
            const origin = resolvedOrigin(element);
            return field === 'originX' ? origin.x : origin.y;
        }

        return element.transform[field];
    }

    setTransformValue(element: AnyElement | undefined, field: TransformField, value: number | string | null) {
        if(!element) {
            return;
        }

        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        if(this.animation.mode === 'animate') {
            if((field === 'scaleX' || field === 'scaleY' || field === 'rotation') && (element.transform.originX == null || element.transform.originY == null)) {
                pinTransformOrigin(element);
            }
            this.animation.setAnimatedPropertyValue(element, `transform.${field}`, 'number', numeric);
            this.scheduleAttributeSnapshot();
            return;
        }

        if((field === 'scaleX' || field === 'scaleY' || field === 'rotation') && (element.transform.originX == null || element.transform.originY == null)) {
            pinTransformOrigin(element);
        }

        element.transform[field] = numeric;
        this.scheduleAttributeSnapshot();
    }

    flipElement(element: AnyElement | undefined, axis: 'x' | 'y') {
        if(!element) {
            return;
        }

        if(element.transform.originX == null || element.transform.originY == null) {
            pinTransformOrigin(element);
        }

        if(axis === 'x') {
            element.transform.scaleX = -element.transform.scaleX;
        } else {
            element.transform.scaleY = -element.transform.scaleY;
        }

        this.scheduleAttributeSnapshot();
    }

    shapeFrameValue(shape: Shape, field: ShapeFrameField): number {
        switch(field) {
            case 'x': return shape.position.x;
            case 'y': return shape.position.y;
            case 'width': return shape.settings.width;
            case 'height': return shape.settings.height;
        }
    }

    setShapeFrameValue(shape: Shape, field: ShapeFrameField, value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        switch(field) {
            case 'x':
                shape.position.x = numeric;
                break;
            case 'y':
                shape.position.y = numeric;
                break;
            case 'width':
                shape.settings.width = Math.max(1, numeric);
                break;
            case 'height':
                shape.settings.height = Math.max(1, numeric);
                break;
        }

        this.scheduleAttributeSnapshot();
    }

    selectedCornerAnchor(path: Path): Point | null {
        const anchor = this.editor.selectedPathAnchor;
        return anchor && path.findPointById(anchor.id) === anchor ? anchor : null;
    }

    cornerRadiusValue(anchor: Point): number {
        return anchor.cornerRadius ?? 0;
    }

    cornerRadiusEnabled(path: Path, anchor: Point): boolean {
        return path.cornerEligible(anchor);
    }

    anchorPositionValue(anchor: Point, axis: 'x' | 'y'): number {
        return anchor[axis];
    }

    setAnchorPositionValue(path: Path, anchor: Point, axis: 'x' | 'y', value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        const delta = axis === 'x'
            ? new Point(numeric - anchor.x, 0)
            : new Point(0, numeric - anchor.y);
        this.movePathAnchor(path, anchor, delta);
        this.scheduleAttributeSnapshot();
    }

    setCornerRadius(path: Path, anchor: Point, value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) {
            return;
        }

        anchor.cornerRadius = Math.max(0, numeric);
        this.scheduleAttributeSnapshot();
    }

    private movePathAnchor(path: Path, anchor: Point, delta: Point) {
        const moved: Point[] = [anchor];
        anchor.addTo(delta);

        path.contours.flatMap((contour) => contour.lines).forEach((line) => {
            if(line.points[0] == anchor && line.controlStart && !moved.includes(line.controlStart)) {
                line.controlStart.addTo(delta);
                moved.push(line.controlStart);
            }

            if(line.points[1] == anchor && line.controlEnd && !moved.includes(line.controlEnd)) {
                line.controlEnd.addTo(delta);
                moved.push(line.controlEnd);
            }
        });
    }

    private animationPropertySupported(element: AnyElement, definition: AnimatablePropertyDefinition): boolean {
        if(definition.property === 'path.drawProgress') {
            return element instanceof Path;
        }

        if(definition.property.startsWith('motion.')) {
            return !!element.motion.pathId;
        }

        if(definition.property.startsWith('transform.') || definition.property === 'visible' || definition.property === 'opacity') {
            return true;
        }

        if(definition.property.startsWith('settings.')) {
            if(definition.property === 'settings.fill' || definition.property === 'settings.stroke' || definition.property.includes('.gradient.')) {
                return readAnimationProperty(element, definition.property) !== undefined;
            }
            const key = definition.property.slice('settings.'.length);
            return key in (element.settings as Record<string, unknown>);
        }

        return readAnimationProperty(element, definition.property) !== undefined;
    }

    private normalizeAnimationValue(value: unknown, definition: AnimatablePropertyDefinition): unknown {
        if(definition.valueType === 'color') {
            return createAnimationColorValue(value, value instanceof Color ? value.preferredSpace : 'rgb');
        }

        if(definition.valueType === 'number') {
            const numeric = typeof value === 'number' ? value : Number(value);
            if(!Number.isFinite(numeric)) {
                return value;
            }

            return definition.property === 'path.drawProgress' || definition.property === 'motion.progress'
                ? Math.max(0, Math.min(1, numeric))
                : numeric;
        }

        return value;
    }
}

type TransformField = "translateX" | "translateY" | "scaleX" | "scaleY" | "rotation" | "originX" | "originY";
type ShapeFrameField = "x" | "y" | "width" | "height";
