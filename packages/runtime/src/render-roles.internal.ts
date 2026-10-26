/**
 * Resolves the mask path used to reveal a dashed animated path.
 *
 * Editor markup keeps the mask inside the target group, while portable artwork
 * may emit the mask as a sibling in `<defs>`. Keep that layout distinction out
 * of both renderers and always scope the fallback lookup to the owning SVG.
 */
export function pathRevealNodes(root: ParentNode, targetNode: SVGElement, targetId: string): SVGElement[] {
    if(isClippingGeometry(targetNode) || targetNode.getAttribute('data-render-projection') === 'fill') return [];
    const nested = [...targetNode.querySelectorAll<SVGElement>('[data-render-role~="reveal"]')];
    if(nested.length) return nested;

    const scope = targetNode.ownerSVGElement ?? root;
    const maskId = `stroke-draw-${targetId}`;
    return [...scope.querySelectorAll<SVGElement>('[data-render-role~="reveal"]')]
        .filter((node) => {
            const mask = node.closest('mask');
            return mask?.getAttribute('id') === maskId || mask?.getAttribute('data-render-target') === maskId;
        });
}

/** A clipping source has geometry and paint projections, all owned by the same document target. */
export function renderTargetNodes(root: ParentNode, targetId: string): SVGElement[] {
    const value = targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return [...root.querySelectorAll<SVGElement>(`[id="${value}"], [data-render-target="${value}"]`)];
}

export function isClippingGeometry(node: SVGElement): boolean {
    return ['clip', 'clip-child'].includes(node.getAttribute('data-render-projection') ?? '');
}

/** Respect projection roles even for a bare path, ellipse, rectangle or text node. */
export function paintRoleNodes(node: SVGElement, role: 'fill' | 'stroke'): SVGElement[] {
    if(isClippingGeometry(node)) return [];
    const projection = node.getAttribute('data-render-projection');
    if(projection === 'fill' && role === 'stroke' || projection === 'stroke' && role === 'fill') return [];
    if(node.tagName.toLowerCase() === 'g') return [...node.querySelectorAll<SVGElement>(`[data-render-role~="${role}"]`)];
    const roles = node.getAttribute('data-render-role');
    return !roles || roles.split(/\s+/).includes(role) ? [node] : [];
}

/** Aligned stroke and reveal definitions can be siblings of portable target roots. */
export function geometryRoleNodes(root: ParentNode, node: SVGElement, targetId: string): SVGElement[] {
    const geometry = node.tagName.toLowerCase() === 'g'
        ? [...node.querySelectorAll<SVGElement>('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]')]
        : [node];
    if(!isClippingGeometry(node) && node.getAttribute('data-render-projection') !== 'fill') {
        for(const prefix of ['stroke-inside-', 'stroke-outside-', 'stroke-draw-']) {
            for(const effect of renderTargetNodes(root, prefix + targetId)) geometry.push(...effect.querySelectorAll<SVGElement>('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]'));
        }
    }
    return [...new Set(geometry)];
}

export function projectedDefinitionId(node: SVGElement, canonicalId: string): string {
    return renderTargetNodes(node, canonicalId)[0]?.id ?? canonicalId;
}
