/**
 * Resolves the mask path used to reveal a dashed animated path.
 *
 * Editor markup keeps the mask inside the target group, while portable artwork
 * may emit the mask as a sibling in `<defs>`. Keep that layout distinction out
 * of both renderers and always scope the fallback lookup to the owning SVG.
 */
export function pathRevealNodes(root, targetNode, targetId) {
    if (isClippingGeometry(targetNode) || targetNode.getAttribute('data-render-projection') === 'fill')
        return [];
    const nested = [...targetNode.querySelectorAll('[data-render-role~="reveal"]')];
    if (nested.length)
        return nested;
    const scope = targetNode.ownerSVGElement ?? root;
    const maskId = `stroke-draw-${targetId}`;
    return [...scope.querySelectorAll('[data-render-role~="reveal"]')]
        .filter((node) => {
        const mask = node.closest('mask');
        return mask?.getAttribute('id') === maskId || mask?.getAttribute('data-render-target') === maskId;
    });
}
/** A clipping source has geometry and paint projections, all owned by the same document target. */
export function renderTargetNodes(root, targetId) {
    const value = targetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return [...root.querySelectorAll(`[id="${value}"], [data-render-target="${value}"]`)];
}
export function isClippingGeometry(node) {
    return ['clip', 'clip-child'].includes(node.getAttribute('data-render-projection') ?? '');
}
/** Respect projection roles even for a bare path, ellipse, rectangle or text node. */
export function paintRoleNodes(node, role) {
    if (isClippingGeometry(node))
        return [];
    const projection = node.getAttribute('data-render-projection');
    if (projection === 'fill' && role === 'stroke' || projection === 'stroke' && role === 'fill')
        return [];
    if (node.tagName.toLowerCase() === 'g')
        return [...node.querySelectorAll(`[data-render-role~="${role}"]`)];
    const roles = node.getAttribute('data-render-role');
    return !roles || roles.split(/\s+/).includes(role) ? [node] : [];
}
/** Aligned stroke and reveal definitions can be siblings of portable target roots. */
export function geometryRoleNodes(root, node, targetId) {
    const geometry = node.tagName.toLowerCase() === 'g'
        ? [...node.querySelectorAll('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]')]
        : [node];
    if (!isClippingGeometry(node) && node.getAttribute('data-render-projection') !== 'fill') {
        for (const prefix of ['stroke-inside-', 'stroke-outside-', 'stroke-draw-']) {
            for (const effect of renderTargetNodes(root, prefix + targetId))
                geometry.push(...effect.querySelectorAll('[data-render-role~="geometry"], [data-render-role~="geometry-effect"]'));
        }
    }
    return [...new Set(geometry)];
}
export function projectedDefinitionId(node, canonicalId) {
    return renderTargetNodes(node, canonicalId)[0]?.id ?? canonicalId;
}
//# sourceMappingURL=render-roles.internal.js.map