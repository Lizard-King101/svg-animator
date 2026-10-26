/** Rendering instances share document geometry; they never create editable artwork. */
export interface RenderProjection {
    kind: 'clip' | 'clip-child' | 'fill' | 'stroke';
    key: string;
}

export function projectionId(id: string, projection?: RenderProjection): string {
    return projection ? `${id}--${projection.key}` : id;
}

export function clippingProjection(groupId: string, kind: 'clip' | 'fill' | 'stroke', parent?: RenderProjection): RenderProjection {
    return { kind, key: `${kind}-${projectionId(groupId, parent)}` };
}

export function childProjection(projection?: RenderProjection): RenderProjection | undefined {
    return projection?.kind === 'clip' ? { ...projection, kind: 'clip-child' } : projection;
}

export function isClipProjection(projection?: RenderProjection): boolean {
    return projection?.kind === 'clip' || projection?.kind === 'clip-child';
}

export function projectionFill(projection?: RenderProjection): boolean {
    return !isClipProjection(projection) && projection?.kind !== 'stroke';
}

export function projectionStroke(projection?: RenderProjection): boolean {
    return !isClipProjection(projection) && projection?.kind !== 'fill';
}

export function projectionVisible(visible: boolean, projection?: RenderProjection): boolean {
    return projection?.kind === 'clip' || visible;
}

export function projectionRoles(projection?: RenderProjection): string {
    return ['geometry', projectionFill(projection) ? 'fill' : '', projectionStroke(projection) ? 'stroke' : ''].filter(Boolean).join(' ');
}
