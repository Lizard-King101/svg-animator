/**
 * Resolves the mask path used to reveal a dashed animated path.
 *
 * Editor markup keeps the mask inside the target group, while portable artwork
 * may emit the mask as a sibling in `<defs>`. Keep that layout distinction out
 * of both renderers and always scope the fallback lookup to the owning SVG.
 */
export function pathRevealNodes(root: ParentNode, targetNode: SVGElement, targetId: string): SVGElement[] {
    const nested = [...targetNode.querySelectorAll<SVGElement>('[data-render-role~="reveal"]')];
    if(nested.length) return nested;

    const scope = targetNode.ownerSVGElement ?? root;
    const maskId = `stroke-draw-${targetId}`;
    return [...scope.querySelectorAll<SVGElement>('[data-render-role~="reveal"]')]
        .filter((node) => node.closest("mask")?.getAttribute("id") === maskId);
}
