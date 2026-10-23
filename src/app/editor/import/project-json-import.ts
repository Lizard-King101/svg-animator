import { restoreReferenceImage } from '../objects/reference-image';
import { DOCUMENT_ENVELOPE_KIND, migrateDocument } from "../migrations/document-migrations";
import { SVGSave } from "../objects/svg.object";
import { sanitizeSVGFragment } from "./svg-sanitizer";

/** Validate external files before the tolerant storage migrations can normalize them. */
export function parseProjectJSON(source: string): { document: SVGSave; migrated: boolean; removedCount: number } {
    let input: unknown;
    try { input = JSON.parse(source.replace(/^\uFEFF/, '')); }
    catch { throw new Error("This file is not valid JSON. Choose an exported SVG Animator project."); }
    validateTree(input);
    const envelope = record(input);
    const raw = record(envelope.kind === DOCUMENT_ENVELOPE_KIND ? envelope.data : input);
    if(raw.animation != null) {
        const animation = record(raw.animation);
        if(animation.version != null && animation.version !== 1 && animation.version !== 2) {
            throw new Error("This project uses an unsupported animation version. Open it with a compatible version of SVG Animator.");
        }
        validateAnimation(animation);
    }
    const migrated = migrateDocument(input);
    if(migrated.status === 'unsupported') {
        throw new Error("This project uses an unsupported document version. Open it with a compatible version of SVG Animator.");
    }
    if(migrated.status !== 'ok') invalid("document");
    const document = migrated.value.data;
    validateElements(document.elements, new Set());
    if(document.referenceImage != null) {
        const reference = restoreReferenceImage(document.referenceImage);
        requireValue(!!reference, "reference image");
        document.referenceImage = reference;
    }
    if(document.guides != null) array(document.guides).forEach((value) => {
        const guide = record(value);
        string(guide.id);
        requireValue(guide.axis === 'x' || guide.axis === 'y', "guide");
        number(guide.value);
    });

    let removedCount = 0;
    if(document.importedSourceNodes != null) {
        document.importedSourceNodes = array(document.importedSourceNodes).map((value) => {
            const node = record(value);
            string(node.id); string(node.tagName); string(node.markup);
            requireValue(node.parentId == null || typeof node.parentId === 'string', "preserved SVG parent");
            const sanitized = sanitizeSVGFragment(node.markup as string);
            removedCount += sanitized.removedCount;
            const serializer = new XMLSerializer();
            const markup = Array.from(sanitized.root.childNodes).map((child) => serializer.serializeToString(child)).join('');
            return { ...node, markup } as NonNullable<SVGSave['importedSourceNodes']>[number];
        });
    }
    return { document, migrated: migrated.migrated, removedCount };
}

function validateElements(elements: unknown, ids: Set<string>): void {
    array(elements).forEach((value) => {
        const element = record(value);
        const id = string(element.id);
        requireValue(!ids.has(id), "duplicate layer ID");
        ids.add(id);
        string(element.name);
        requireValue(typeof element.visible === 'boolean' && typeof element.locked === 'boolean', "layer visibility");
        if(element.type === 'group') {
            validateElements(element.elements, ids);
            return;
        }
        const settings = record(element.settings);
        if(element.type === 'shape') {
            requireValue(element.shapeType === 'rectangle' || element.shapeType === 'ellipse', "shape type");
            point(element.position);
            number(settings.width); number(settings.height);
        } else if(element.type === 'path') {
            if(element.contours != null) array(element.contours).forEach((value) => {
                const contour = record(value);
                string(contour.id);
                requireValue(typeof contour.closed === 'boolean', "contour");
                lines(contour.lines);
            });
            if(element.lines != null) lines(element.lines);
        } else if(element.type === 'text') {
            point(element.position);
            string(settings.content); string(settings.font_family); string(settings.font_weight);
            number(settings.font_size);
        } else invalid("unsupported layer type");
        if(element.type !== 'text') number(settings.stroke_width);
        ['stroke', 'fill', 'color'].forEach((key) => paint(settings[key]));
    });
}

function lines(value: unknown): void {
    array(value).forEach((value) => {
        const line = record(value);
        string(line.id);
        requireValue(line.type === 'line' || line.type === 'bezier', "segment type");
        const points = array(line.points);
        // A pen gesture can be saved with its last segment still containing
        // only the starting anchor. This is a valid editable project state.
        requireValue(points.length >= 1 && points.length <= 2, "segment endpoints");
        points.forEach(point);
        if(line.controlStart != null) point(line.controlStart);
        if(line.controlEnd != null) point(line.controlEnd);
    });
}

function point(value: unknown): void {
    const item = record(value);
    string(item.id); number(item.x); number(item.y);
}

function paint(value: unknown): void {
    if(value == null || typeof value === 'string') return;
    const item = record(value);
    requireValue(item.type === 'linear-gradient' || item.type === 'radial-gradient', "paint type");
    string(item.id); record(item.coordinates);
    array(item.stops).forEach((value) => {
        const stop = record(value);
        string(stop.id); number(stop.offset); string(stop.color);
    });
}

function validateAnimation(animation: Record<string, unknown>): void {
    number(animation.duration);
    array(animation.tracks).forEach((value) => {
        const track = record(value);
        string(track.id); string(track.targetId); string(track.property);
        requireValue(['number', 'color', 'boolean', 'string'].includes(String(track.valueType)), "animation value type");
        array(track.keyframes).forEach((value) => {
            const key = record(value);
            string(key.id); number(key.time);
            requireValue('value' in key, "keyframe value");
        });
    });
    if(animation.markers != null) array(animation.markers).forEach((value) => {
        const marker = record(value);
        string(marker.id); string(marker.name); number(marker.time);
    });
}

function validateTree(value: unknown, depth = 0): void {
    requireValue(depth <= 128, "excessively nested data");
    if(typeof value === 'number') number(value);
    if(value && typeof value === 'object') Object.values(value).forEach((child) => validateTree(child, depth + 1));
}

function record(value: unknown): Record<string, unknown> {
    requireValue(!!value && typeof value === 'object' && !Array.isArray(value), "object");
    return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] { requireValue(Array.isArray(value), "list"); return value as unknown[]; }
function string(value: unknown): string { requireValue(typeof value === 'string', "text"); return value as string; }
function number(value: unknown): void { requireValue(typeof value === 'number' && Number.isFinite(value), "number"); }
function requireValue(valid: boolean, detail: string): asserts valid { if(!valid) invalid(detail); }
function invalid(detail: string): never { throw new Error(`This project contains invalid ${detail}. Nothing was imported.`); }
