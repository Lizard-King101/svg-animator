import { Color } from "./color.object";
import { resolvedOrigin } from "./element-bounds";
import { Group } from "./elements/group.object";
import { AnyElement } from "./svg.object";
import { AnimationColorValue } from "./animation.object";

export interface AnimationPropertySnapshot {
    targetId: string;
    property: string;
    value: unknown;
}

export interface AppliedAnimationValue extends AnimationPropertySnapshot {
    applied: boolean;
}

export function animationPropertyKey(targetId: string, property: string): string {
    return `${targetId}:${property}`;
}

export function findAnimationTarget(elements: AnyElement[], id: string): AnyElement | undefined {
    for(const element of elements) {
        if(element.id === id) {
            return element;
        }

        if(element instanceof Group) {
            const found = findAnimationTarget(element.elements, id);
            if(found) {
                return found;
            }
        }
    }

    return undefined;
}

export function readAnimationProperty(element: AnyElement, property: string): unknown {
    switch(property) {
        case "transform.translateX":
            return element.transform.translateX;
        case "transform.translateY":
            return element.transform.translateY;
        case "transform.scaleX":
            return element.transform.scaleX;
        case "transform.scaleY":
            return element.transform.scaleY;
        case "transform.rotation":
            return element.transform.rotation;
        case "transform.originX":
            return resolvedOrigin(element).x;
        case "transform.originY":
            return resolvedOrigin(element).y;
        case "opacity":
            return element.opacity;
        case "settings.fill":
            return colorHex((element.settings as Record<string, unknown>)["fill"]);
        case "settings.stroke":
            return colorHex((element.settings as Record<string, unknown>)["stroke"]);
        case "settings.stroke_width":
            return (element.settings as Record<string, unknown>)["stroke_width"];
        case "visible":
            return element.visible;
        default:
            return undefined;
    }
}

export function writeAnimationProperty(element: AnyElement, property: string, value: unknown): boolean {
    switch(property) {
        case "transform.translateX":
            return writeNumber(value, (numeric) => element.transform.translateX = numeric);
        case "transform.translateY":
            return writeNumber(value, (numeric) => element.transform.translateY = numeric);
        case "transform.scaleX":
            return writeNumber(value, (numeric) => element.transform.scaleX = numeric);
        case "transform.scaleY":
            return writeNumber(value, (numeric) => element.transform.scaleY = numeric);
        case "transform.rotation":
            return writeNumber(value, (numeric) => element.transform.rotation = numeric);
        case "transform.originX":
            return writeNumber(value, (numeric) => element.transform.originX = numeric);
        case "transform.originY":
            return writeNumber(value, (numeric) => element.transform.originY = numeric);
        case "opacity":
            return writeNumber(value, (numeric) => element.opacity = Math.max(0, Math.min(1, numeric)));
        case "settings.fill":
            return writeColor(element, "fill", value);
        case "settings.stroke":
            return writeColor(element, "stroke", value);
        case "settings.stroke_width":
            return writeNumber(value, (numeric) => (element.settings as Record<string, unknown>)["stroke_width"] = numeric);
        case "visible":
            element.visible = Boolean(value);
            return true;
        default:
            return false;
    }
}

function writeNumber(value: unknown, write: (value: number) => void): boolean {
    const numeric = typeof value === "number" ? value : Number(value);
    if(!Number.isFinite(numeric)) {
        return false;
    }

    write(numeric);
    return true;
}

function writeColor(element: AnyElement, key: "fill" | "stroke", value: unknown): boolean {
    if(value == null) {
        (element.settings as Record<string, unknown>)[key] = null;
        return true;
    }

    if(isAnimationColorValue(value)) {
        (element.settings as Record<string, unknown>)[key] = new Color(value.hex);
        return true;
    }

    if(typeof value !== "string") {
        return false;
    }

    (element.settings as Record<string, unknown>)[key] = new Color(value);
    return true;
}

function colorHex(value: unknown): string | null | undefined {
    if(value == null) {
        return value as null | undefined;
    }

    return value instanceof Color ? value.hex : String(value);
}

function isAnimationColorValue(value: unknown): value is AnimationColorValue {
    return !!value
        && typeof value === "object"
        && (value as Partial<AnimationColorValue>).type === "color"
        && typeof (value as Partial<AnimationColorValue>).hex === "string";
}
