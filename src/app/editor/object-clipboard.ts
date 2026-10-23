import { findElementChain, resolvedOrigin } from './objects/element-bounds';
import { Group } from './objects/elements/group.object';
import { AnyElement, ElementSave, SVG, SVGSave } from './objects/svg.object';
import { selectionRoots } from './selection';
import { sanitizeSVGFragment } from './import/svg-sanitizer';
import { rewriteLocalIdReferences } from './import/svg-id-references';

export interface ObjectClipboardFragment {
    document: SVGSave;
    /** Top-level branches containing artwork, excluding extra motion-path dependencies. */
    rootIds: string[];
    count: number;
}

/** Snapshot base artwork plus the ancestor, clip and motion-path context it needs. */
export function captureObjectClipboard(svg: SVG, selected: AnyElement[]): ObjectClipboardFragment | undefined {
    const roots = selectionRoots(svg, selected);
    if(!roots.length) return undefined;
    const included = new Set<AnyElement>();
    const complete = new Set<AnyElement>();
    const artwork = new Set<AnyElement>();
    const masks = new Set<AnyElement>();
    const all = new Map<string, AnyElement>();
    const visit = (elements: AnyElement[], callback: (element: AnyElement) => void) => {
        elements.forEach((element) => { callback(element); if(element instanceof Group) visit(element.elements, callback); });
    };
    visit(svg.elements, (element) => all.set(element.id, element));
    const add = (element: AnyElement, whole: boolean) => {
        findElementChain(svg.elements, element)?.forEach((ancestor) => included.add(ancestor));
        if(whole) visit([element], (child) => { included.add(child); complete.add(child); });
    };
    roots.forEach((element) => {
        add(element, true);
        visit([element], (child) => artwork.add(child));
    });
    // Iteration also visits newly added dependencies, without following cycles forever.
    for(const element of included) {
        if(element instanceof Group && element.clipElement) {
            add(element.clipElement, true);
            visit([element.clipElement], (child) => masks.add(child));
        }
        const motionPath = element.motion.pathId && all.get(element.motion.pathId);
        if(motionPath) add(motionPath, true);
    }
    const hidden = new Set([...complete].filter((element) => !artwork.has(element) && !masks.has(element)));
    const ids = new Set([...included].map((element) => element.id));
    const project = (element: AnyElement): ElementSave => {
        const save = element.save();
        if(hidden.has(element)) save.visible = false;
        if(save.type === 'group' && element instanceof Group) {
            save.elements = element.elements.filter((child) => included.has(child)).map(project);
            if(!complete.has(element)) {
                // Pruning siblings must not move the remaining children around a new center.
                const origin = resolvedOrigin(element);
                save.transform = { ...save.transform, originX: origin.x, originY: origin.y };
                save.locked = false;
            }
        }
        return save;
    };
    const document = svg.save();
    document.elements = svg.elements.filter((element) => included.has(element)).map(project);
    document.animation!.tracks = document.animation!.tracks.filter((track) => ids.has(track.targetId)
        && !(track.property === 'visible' && hidden.has(all.get(track.targetId)!)));
    document.animation!.markers = [];
    document.animation!.variables = [];
    document.guides = [];
    document.importedSourceNodes = document.importedSourceNodes!.filter((node) => node.tagName.toLowerCase() === 'defs'
        || (node.parentId != null && complete.has(all.get(node.parentId)!))).map((node) => ({
            ...node, parentId: node.parentId && ids.has(node.parentId) ? node.parentId : null,
        }));
    const rootIds = svg.elements.filter((element) => roots.some((root) => findElementChain(svg.elements, root)?.[0] === element)).map((element) => element.id);
    return { document, rootIds, count: roots.length };
}

/** Each paste gets independent IDs, including geometry channels and preserved SVG resources. */
export function instantiateObjectClipboard(fragment: ObjectClipboardFragment, namespace: string, offset = 0): ObjectClipboardFragment {
    const copy: ObjectClipboardFragment = JSON.parse(JSON.stringify(fragment));
    const ids = new Map<string, string>();
    const register = (id: string) => { if(!ids.has(id)) ids.set(id, `${namespace}-${id}`); };
    const walk = (value: unknown, callback: (object: Record<string, unknown>) => void): void => {
        if(!value || typeof value !== 'object') return;
        if(Array.isArray(value)) { value.forEach((entry) => walk(entry, callback)); return; }
        const object = value as Record<string, unknown>;
        callback(object);
        Object.values(object).forEach((entry) => walk(entry, callback));
    };
    walk(copy.document, (object) => { if(typeof object.id === 'string') register(object.id); });
    const sources = (copy.document.importedSourceNodes ?? []).map((node) => {
        const root = sanitizeSVGFragment(node.markup).root;
        root.querySelectorAll('[id]').forEach((element) => register(element.getAttribute('id')!));
        return { node, root };
    });
    // Native clipping IDs are derived, rather than stored as their own model field.
    [...ids].forEach(([id, replacement]) => {
        if(!ids.has(`clip-${id}`)) ids.set(`clip-${id}`, `clip-${replacement}`);
    });
    walk(copy.document, (object) => {
        for(const key of ['id', 'targetId', 'parentId', 'clipElementId', 'pathId']) {
            const value = object[key];
            if(typeof value === 'string') object[key] = ids.get(value) ?? (key === 'pathId' || key === 'clipElementId' ? null : value);
        }
        if(typeof object.property === 'string') {
            object.property = object.property
                .replace(/^(path\.points\.)([^.]+)(\.[xy])$/, (_, prefix, id, suffix) => `${prefix}${ids.get(id) ?? id}${suffix}`)
                .replace(/^(settings\.[^.]+\.gradient\.stops\.)([^.]+)(\.[^.]+)$/, (_, prefix, id, suffix) => `${prefix}${ids.get(id) ?? id}${suffix}`);
        }
    });
    sources.forEach(({ node, root }) => {
        root.querySelectorAll('*').forEach((element) => Array.from(element.attributes).forEach((attribute) => {
            const value = attribute.name === 'id' ? ids.get(attribute.value) ?? attribute.value
                : rewriteLocalIdReferences(attribute.value, ids, attribute.name.toLowerCase());
            element.setAttributeNS(attribute.namespaceURI, attribute.name, value);
        }));
        node.markup = Array.from(root.childNodes).map((node) => new XMLSerializer().serializeToString(node)).join('');
    });
    copy.rootIds = copy.rootIds.map((id) => ids.get(id)!);
    const rootIds = new Set(copy.document.elements.map((element) => element.id));
    copy.document.elements.forEach((element) => {
        element.transform = { ...element.transform,
            translateX: (element.transform?.translateX ?? 0) + offset,
            translateY: (element.transform?.translateY ?? 0) + offset };
        if(copy.rootIds.includes(element.id)) { element.name += ' Copy'; element.locked = false; }
    });
    // Translate the animation too, so the paste offset survives preview and playback.
    copy.document.animation?.tracks.forEach((track) => {
        if(rootIds.has(track.targetId) && ['transform.translateX', 'transform.translateY'].includes(track.property)) {
            track.keyframes.forEach((keyframe) => { if(typeof keyframe.value === 'number') keyframe.value += offset; });
        }
    });
    return copy;
}
