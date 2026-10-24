import { Color } from './color.object';
import { Paint } from './paint.object';

export interface DrawingPaint {
    fill: string | null;
    stroke: string | null;
    strokeWidth: number;
}

export const DEFAULT_DRAWING_PAINT: Readonly<DrawingPaint> = { fill: '#2dd4bf', stroke: '#2dd4bf', strokeWidth: 2 };
export const MAX_DRAWING_STROKE_WIDTH = 1000;

export function normalizeDrawingPaint(value: unknown): DrawingPaint {
    const input = value && typeof value === 'object' ? value as Partial<DrawingPaint> : {};
    const normalize = (color: unknown, fallback: string | null): string | null =>
        color === null ? null : typeof color === 'string' && new Color().isColor(color)
            ? new Color(color).serialized : fallback;
    const width = input.strokeWidth;
    return {
        fill: normalize(input.fill, DEFAULT_DRAWING_PAINT.fill),
        stroke: normalize(input.stroke, DEFAULT_DRAWING_PAINT.stroke),
        strokeWidth: typeof width === 'number' && Number.isFinite(width)
            ? Math.max(0, Math.min(MAX_DRAWING_STROKE_WIDTH, width)) : DEFAULT_DRAWING_PAINT.strokeWidth,
    };
}

/** Apply only to newly authored geometry; restoration and copying keep their own paints. */
export function applyDrawingPaint(settings: { fill: Paint | null; stroke: Paint | null; stroke_width: number; fill_enabled?: boolean }, paint: DrawingPaint, filled = true): void {
    settings.fill = paint.fill === null ? null : new Color(paint.fill);
    settings.stroke = paint.stroke === null ? null : new Color(paint.stroke);
    settings.stroke_width = paint.strokeWidth;
    if('fill_enabled' in settings) settings.fill_enabled = filled && settings.fill !== null;
}

export function drawingColorVisible(value: string | null): boolean {
    return value !== null && new Color(value).alpha > 0;
}
