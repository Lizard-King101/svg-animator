import { Bounds } from './transform.object';

/** Embedded editor aid; never part of exported artwork or animation. */
export interface ReferenceImage extends Bounds {
    source: string;
    name: string;
    opacity: number;
    visible: boolean;
    locked: boolean;
}

export function restoreReferenceImage(input: unknown): ReferenceImage | undefined {
    if(!input || typeof input !== 'object') return undefined;
    const value = input as ReferenceImage;
    if(typeof value.source !== 'string' || value.source.length > 14 * 1024 * 1024
        || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value.source)) return undefined;
    if(![value.x, value.y, value.width, value.height, value.opacity].every(Number.isFinite)
        || value.width <= 0 || value.height <= 0) return undefined;
    return {
        source: value.source, name: typeof value.name === 'string' ? value.name : 'Reference image',
        x: value.x, y: value.y, width: value.width, height: value.height,
        opacity: Math.max(0, Math.min(1, value.opacity)), visible: value.visible !== false, locked: value.locked !== false,
    };
}

export function fitReference(image: Pick<Bounds, 'width' | 'height'>, canvas: Bounds): Bounds {
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    return { x: canvas.x + (canvas.width - width) / 2, y: canvas.y + (canvas.height - height) / 2, width, height };
}
