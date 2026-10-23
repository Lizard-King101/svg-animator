import { Color } from './color.object';
import type { SVGSave, ElementSave } from './svg.object';
import { PaintSave } from './paint.object';
import { createAnimationColorValue } from './animation.object';

export interface ProjectColor { color: string; name?: string; pinned?: boolean; }

export function canonicalColor(value: unknown): string | undefined {
    return typeof value === 'string' && new Color().isColor(value) ? new Color(value).serialized : undefined;
}

export function validProjectColors(value: unknown): value is ProjectColor[] {
    return Array.isArray(value) && value.every(item => item && typeof item === 'object'
        && !!canonicalColor(item.color) && (item.name === undefined || typeof item.name === 'string' && item.name.length <= 80)
        && (item.pinned === undefined || typeof item.pinned === 'boolean'));
}

export function restoreProjectColors(value: unknown): ProjectColor[] {
    if(!validProjectColors(value)) return [];
    const seen = new Set<string>();
    return value.flatMap(item => {
        const color = canonicalColor(item.color)!;
        if(seen.has(color)) return [];
        seen.add(color);
        return [{ color, ...(item.name?.trim() ? { name: item.name.trim() } : {}), ...(item.pinned ? { pinned: true } : {}) }];
    });
}

/** Stable usage keys detect newly chosen values without reordering unchanged colors. */
export function authoredColors(document?: SVGSave): Map<string, string> {
    const colors = new Map<string, string>();
    const add = (key: string, value: unknown, opacity?: number) => {
        const hex = canonicalColor(value);
        if(!hex) return;
        const color = new Color(hex);
        if(opacity !== undefined && Number.isFinite(opacity)) color.alpha = Math.max(0, Math.min(1, opacity));
        colors.set(key, color.serialized);
    };
    const paint = (key: string, value: PaintSave | undefined) => {
        if(typeof value === 'string') add(key, value);
        else if(value && Array.isArray(value.stops)) value.stops.forEach(stop => add(`${key}/${stop.id}`, stop.color, stop.opacity));
    };
    const visit = (elements: ElementSave[]) => elements.forEach(element => {
        if(element.type === 'group') { visit(element.elements); return; }
        const settings = element.settings as unknown as Record<string, PaintSave>;
        for(const key of ['fill', 'stroke', 'color']) paint(`${element.id}/${key}`, settings[key]);
    });
    if(document) {
        visit(document.elements);
        document.animation?.tracks.forEach(track => {
            if(track.valueType === 'color') track.keyframes.forEach(key => {
                const value = createAnimationColorValue(key.value);
                if(value && typeof value === 'object') add(`animation/${track.id}/${key.id}`, value.hex, value.alpha);
            });
        });
    }
    return colors;
}

export function mergeProjectColors(palette: readonly ProjectColor[], colors: Iterable<string>): ProjectColor[] {
    const result = palette.map(item => ({ ...item })), seen = new Set(result.map(item => item.color));
    for(const color of colors) if(!seen.has(color)) { seen.add(color); result.push({ color }); }
    return result;
}

export function useProjectColor(palette: readonly ProjectColor[], value: string): ProjectColor[] {
    const color = canonicalColor(value);
    if(!color) return [...palette];
    return [{ ...(palette.find(item => item.color === color) ?? {}), color }, ...palette.filter(item => item.color !== color)];
}

/** Called only for a real document commit, never for render/hover/playback. */
export function committedProjectColors(before: SVGSave | undefined, after: SVGSave): ProjectColor[] {
    const previous = authoredColors(before), current = authoredColors(after);
    let result = mergeProjectColors(after.projectColors ?? [], previous.values());
    result = mergeProjectColors(result, current.values());
    for(const [key, color] of current) if(previous.get(key) !== color) result = useProjectColor(result, color);
    return result;
}
