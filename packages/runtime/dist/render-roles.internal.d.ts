/**
 * Resolves the mask path used to reveal a dashed animated path.
 *
 * Editor markup keeps the mask inside the target group, while portable artwork
 * may emit the mask as a sibling in `<defs>`. Keep that layout distinction out
 * of both renderers and always scope the fallback lookup to the owning SVG.
 */
export declare function pathRevealNodes(root: ParentNode, targetNode: SVGElement, targetId: string): SVGElement[];
/** A clipping source has geometry and paint projections, all owned by the same document target. */
export declare function renderTargetNodes(root: ParentNode, targetId: string): SVGElement[];
export declare function isClippingGeometry(node: SVGElement): boolean;
/** Respect projection roles even for a bare path, ellipse, rectangle or text node. */
export declare function paintRoleNodes(node: SVGElement, role: 'fill' | 'stroke'): SVGElement[];
/** Aligned stroke and reveal definitions can be siblings of portable target roots. */
export declare function geometryRoleNodes(root: ParentNode, node: SVGElement, targetId: string): SVGElement[];
export declare function projectedDefinitionId(node: SVGElement, canonicalId: string): string;
//# sourceMappingURL=render-roles.internal.d.ts.map