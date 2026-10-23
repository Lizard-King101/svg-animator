import { Color } from './color.object';
import { Bounds } from './transform.object';

export interface SamplingRaster { image: HTMLImageElement; bounds: Bounds; }
export interface ColorSample { color: Color; preview: string; }

/** SVG images default to xMidYMid meet, even for non-proportional imported placements. */
export function fittedImageBounds(bounds: Bounds, width: number, height: number): Bounds {
    const scale = Math.min(bounds.width / width, bounds.height / height);
    const w = width * scale, h = height * scale;
    return { x: bounds.x + (bounds.width - w) / 2, y: bounds.y + (bounds.height - h) / 2, width: w, height: h };
}

export async function decodeSamplingImage(source: string): Promise<HTMLImageElement> {
    const image = new Image(); image.src = source; await image.decode(); return image;
}

/** Snapshot the displayed artwork, excluding temporary construction and editor chrome. */
export async function artworkSamplingRaster(artwork: SVGSVGElement, bounds: Bounds, temporaryIds: string[]): Promise<SamplingRaster> {
    const clone = artwork.cloneNode(true) as SVGSVGElement;
    clone.removeAttribute('style'); clone.removeAttribute('class');
    const rect = artwork.getBoundingClientRect();
    const scale = Math.min(Math.max(1, rect.width) / bounds.width, 4096 / bounds.width, 4096 / bounds.height);
    clone.setAttribute('width', String(Math.max(1, Math.round(bounds.width * scale))));
    clone.setAttribute('height', String(Math.max(1, Math.round(bounds.height * scale))));
    clone.setAttribute('viewBox', `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`);
    const ids = new Set(temporaryIds);
    clone.querySelectorAll('[id]').forEach(node => { if(ids.has(node.id)) node.remove(); });
    const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for(const key of ['x', 'y', 'width', 'height'] as const) background.setAttribute(key, String(bounds[key]));
    background.setAttribute('fill', getComputedStyle(artwork).backgroundColor || '#ffffff');
    clone.prepend(background);
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
    return { image: await decodeSamplingImage(source), bounds };
}

/** Reads only an 11×11 pixel patch; original reference images need no full-size canvas copy. */
export function sampleRaster(raster: SamplingRaster, point: Pick<Bounds, 'x' | 'y'>): ColorSample | undefined {
    const { bounds: b, image } = raster;
    if(point.x < b.x || point.y < b.y || point.x >= b.x + b.width || point.y >= b.y + b.height) return;
    const x = Math.floor((point.x - b.x) / b.width * image.naturalWidth);
    const y = Math.floor((point.y - b.y) / b.height * image.naturalHeight);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 11;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if(!context) throw new Error('Pixel sampling is unavailable.');
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 5 - x, 5 - y);
    const pixel = context.getImageData(5, 5, 1, 1).data;
    if(pixel[3] === 0) return;
    const color = new Color(); color.rgb = { r: pixel[0], g: pixel[1], b: pixel[2] }; color.alpha = pixel[3] / 255;
    return { color, preview: canvas.toDataURL() };
}
