/**
 * Resolves the mask path used to reveal a dashed animated path.
 *
 * Editor markup keeps the mask inside the target group, while portable artwork
 * may emit the mask as a sibling in `<defs>`. Keep that layout distinction out
 * of both renderers and always scope the fallback lookup to the owning SVG.
 */
export declare function pathRevealNodes(root: ParentNode, targetNode: SVGElement, targetId: string): SVGElement[];
//# sourceMappingURL=render-roles.internal.d.ts.map