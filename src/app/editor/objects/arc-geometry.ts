import { PointSave } from "./point.object";

/** Shared SVG endpoint-arc conversion for import and construction. */
interface ArcCubic { controlStart: PointSave; controlEnd: PointSave; end: PointSave; }

export function arcToCubics(
    start: PointSave,
    end: PointSave,
    rawRadiusX: number,
    rawRadiusY: number,
    rotation: number,
    largeArc: boolean,
    sweep: boolean,
    createId: (prefix: string) => string,
): ArcCubic[] {
    let rx = Math.abs(rawRadiusX);
    let ry = Math.abs(rawRadiusY);
    if(rx === 0 || ry === 0 || (start.x === end.x && start.y === end.y)) return [];
    const phi = rotation * Math.PI / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx = (start.x - end.x) / 2;
    const dy = (start.y - end.y) / 2;
    const xPrime = (cosPhi * dx) + (sinPhi * dy);
    const yPrime = (-sinPhi * dx) + (cosPhi * dy);
    const radiusScale = (xPrime * xPrime) / (rx * rx) + (yPrime * yPrime) / (ry * ry);
    if(radiusScale > 1) {
        const scale = Math.sqrt(radiusScale);
        rx *= scale;
        ry *= scale;
    }
    const numerator = Math.max(0, (rx * rx * ry * ry) - (rx * rx * yPrime * yPrime) - (ry * ry * xPrime * xPrime));
    const denominator = (rx * rx * yPrime * yPrime) + (ry * ry * xPrime * xPrime);
    const coefficient = (largeArc === sweep ? -1 : 1) * Math.sqrt(denominator === 0 ? 0 : numerator / denominator);
    const centerPrimeX = coefficient * ((rx * yPrime) / ry);
    const centerPrimeY = coefficient * (-(ry * xPrime) / rx);
    const centerX = cosPhi * centerPrimeX - sinPhi * centerPrimeY + (start.x + end.x) / 2;
    const centerY = sinPhi * centerPrimeX + cosPhi * centerPrimeY + (start.y + end.y) / 2;
    const vectorAngle = (ux: number, uy: number, vx: number, vy: number) => {
        const dot = ux * vx + uy * vy;
        const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        const angle = Math.acos(Math.max(-1, Math.min(1, length === 0 ? 1 : dot / length)));
        return ux * vy - uy * vx < 0 ? -angle : angle;
    };
    const ux = (xPrime - centerPrimeX) / rx;
    const uy = (yPrime - centerPrimeY) / ry;
    const vx = (-xPrime - centerPrimeX) / rx;
    const vy = (-yPrime - centerPrimeY) / ry;
    let startAngle = vectorAngle(1, 0, ux, uy);
    let deltaAngle = vectorAngle(ux, uy, vx, vy);
    if(!sweep && deltaAngle > 0) deltaAngle -= Math.PI * 2;
    if(sweep && deltaAngle < 0) deltaAngle += Math.PI * 2;
    return ellipseArcToCubics({ x: centerX, y: centerY }, { x: cosPhi * rx, y: sinPhi * rx },
        { x: -sinPhi * ry, y: cosPhi * ry }, startAngle, deltaAngle, createId, end);
}

/** Compact, at-most-quarter-turn cubics for an affine ellipse arc. */
export function ellipseArcToCubics(
    center: { x: number; y: number }, axisX: { x: number; y: number }, axisY: { x: number; y: number },
    startAngle: number, deltaAngle: number, createId: (prefix: string) => string, end?: PointSave,
): ArcCubic[] {
    const count = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2) - 1e-10));
    const step = deltaAngle / count;
    const map = (x: number, y: number) => ({
        x: center.x + axisX.x * x + axisY.x * y,
        y: center.y + axisX.y * x + axisY.y * y,
    });
    const result: ArcCubic[] = [];
    for(let i = 0; i < count; i++) {
        const nextAngle = startAngle + step;
        const alpha = (4 / 3) * Math.tan(step / 4);
        const p1 = map(Math.cos(startAngle) - alpha * Math.sin(startAngle), Math.sin(startAngle) + alpha * Math.cos(startAngle));
        const p2 = map(Math.cos(nextAngle) + alpha * Math.sin(nextAngle), Math.sin(nextAngle) - alpha * Math.cos(nextAngle));
        const p3 = i === count - 1 && end ? end : (() => {
            const mapped = map(Math.cos(nextAngle), Math.sin(nextAngle));
            return point(mapped.x, mapped.y, createId);
        })();
        result.push({
            controlStart: point(p1.x, p1.y, createId),
            controlEnd: point(p2.x, p2.y, createId),
            end: p3,
        });
        startAngle = nextAngle;
    }
    return result;
}

function point(x: number, y: number, createId: (prefix: string) => string): PointSave {
    return { id: createId("point"), x, y };
}
