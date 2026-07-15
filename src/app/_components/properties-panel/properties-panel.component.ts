import { NgFor, NgIf } from "@angular/common";
import { Component } from "@angular/core";
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
import { TextElement } from "../../editor/objects/elements/text.object";
import { frameFieldSupported, frameFieldValue, GeometryFrameField, setGeometryFrameField } from "../../editor/objects/element-geometry";
import { Paint, PaintSettingKey } from "../../editor/objects/paint.object";
import { Point } from "../../editor/objects/point.object";
import { AnyElement } from "../../editor/objects/svg.object";
import { geometryAnimationChanges, geometryAnimationValues, readAnimationProperty } from "../../editor/objects/animation-targets";
import { PaintEditorComponent } from "../paint-editor/paint-editor.component";
import { PaintEditorChange } from "../paint-editor/paint-editor.types";
import { PaintEditingService } from "../../_services/paint-editing.service";
import { formatDashArray, parseDashArray, StrokeAlignment } from "../../editor/objects/stroke-style.object";

@Component({
    selector: "app-properties-panel",
    standalone: true,
    imports: [FormsModule, NgFor, NgIf, FaIconComponent, BoolAttribute, ColorAttribute, RangeAttribute, SelectAttribut, TextAttribute, PaintEditorComponent],
    templateUrl: "properties-panel.component.html",
    styles: [":host { display: contents; }"],
})
export class PropertiesPanelComponent {
    readonly ANIMATABLE_PROPERTIES = ANIMATABLE_PROPERTIES;

    constructor(
        public editor: EditorService,
        public animation: AnimationPlaybackService,
        private mutations: DocumentMutationService,
        private paintEditing: PaintEditingService,
    ) {}

    private scheduleAttributeSnapshot(): void { this.mutations.schedule(); }

    asShape(element: AnyElement | undefined): Shape | null {
        return element instanceof Shape ? element : null;
    }

    asPath(element: AnyElement | undefined): Path | null {
        return element instanceof Path ? element : null;
    }

    asFrameElement(element: AnyElement | undefined): Path | Shape | TextElement | null {
        return element instanceof Path || element instanceof Shape || element instanceof TextElement ? element : null;
    }

    asStrokeElement(element: AnyElement | undefined): Path | Shape | null {
        return element instanceof Path || element instanceof Shape ? element : null;
    }

    strokeAlignmentDisabled(element: Path | Shape): boolean {
        return element instanceof Path && element.contours.some((contour) => contour.lines.length > 0 && !contour.closed);
    }

    dashPattern(element: Path | Shape): string {
        return formatDashArray(element.settings.stroke_dasharray);
    }

    setStrokeAlignment(element: Path | Shape, value: StrokeAlignment): void {
        element.settings.stroke_alignment = this.strokeAlignmentDisabled(element) ? "center" : value;
        this.scheduleAttributeSnapshot();
    }

    setDashPattern(element: Path | Shape, value: string): void {
        const parsed = parseDashArray(value);
        if(parsed == null) return;
        element.settings.stroke_dasharray = parsed;
        this.scheduleAttributeSnapshot();
    }

    setStrokeNumber(element: Path | Shape, key: "stroke_dashoffset" | "stroke_miterlimit", value: number | string | null): void {
        const numeric = typeof value === "number" ? value : Number(value);
        if(!Number.isFinite(numeric)) return;
        const normalized = key === "stroke_miterlimit" ? Math.max(1, numeric) : numeric;
        this.handleAttributeChange(element, { label: key, name: key, input: "number", output: key }, normalized);
    }

    /** Bridge for template dynamic-key access on the now-typed settings object. */
    settingsOf(element: AnyElement | undefined): Record<string, any> {
        return (element?.settings ?? {}) as Record<string, any>;
    }

    asPaint(value: unknown): Paint | null { return value as Paint | null; }

    selectGradientPaint(key: string) {
        if(this.isPaintSettingKey(key)) this.editor.selectedGradientPaintKey = key;
    }

    handlePaintChange(element: AnyElement | undefined, key: string, change: PaintEditorChange): void {
        if(!element || !this.isPaintSettingKey(key)) return;
        this.paintEditing.apply(element, key, change);
        if(change.type !== "mode" || change.mode === "gradient") this.selectGradientPaint(key);
    }

    private isPaintSettingKey(key: string): key is PaintSettingKey {
        return key === "fill" || key === "stroke" || key === "color";
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
        this.setFrameValue(shape, field, value);
    }

    frameValue(element: Path | Shape | TextElement, field: GeometryFrameField): number {
        return frameFieldValue(element, field) ?? 0;
    }

    frameFieldSupported(element: Path | Shape | TextElement, field: GeometryFrameField): boolean {
        return frameFieldSupported(element, field);
    }

    setFrameValue(element: Path | Shape | TextElement, field: GeometryFrameField, value: number | string | null) {
        const numeric = typeof value === 'number' ? value : Number(value);
        if(!Number.isFinite(numeric)) return;
        const baseline = this.frameAnimationValues(element);
        if(!setGeometryFrameField(element, field, numeric)) return;
        if(this.animation.mode === "animate") {
            const current = this.frameAnimationValues(element);
            geometryAnimationChanges(element, baseline, current).forEach(({ property, value: next, baseline: start }) => {
                this.animation.upsertKeyframe(element, property, "number", next, start);
            });
        }
        this.scheduleAttributeSnapshot();
    }

    private frameAnimationValues(element: AnyElement): Record<string, number> {
        const values = geometryAnimationValues(element);
        ["transform.translateX", "transform.translateY", "transform.originX", "transform.originY"].forEach((property) => {
            const value = readAnimationProperty(element, property);
            if(typeof value === "number") values[property] = value;
        });
        return values;
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
            if(definition.property === 'settings.fill' || definition.property === 'settings.stroke' || definition.property === 'settings.color' || definition.property.includes('.gradient.')) {
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
