import { geometryRoleNodes, paintRoleNodes, pathRevealNodes } from '../../../../packages/runtime/src/render-roles.internal';

/** Scoped to an imperative renderer. A child-list change invalidates role lookups;
 * attribute writes do not. takeRecords also handles replacement before observer delivery.
 */
export class RenderNodeCache {
    private cache = new WeakMap<SVGElement, Map<string, SVGElement[]>>();
    private observer?: MutationObserver;
    private generation = 0;
    get revision(): number { if(this.observer?.takeRecords().length) this.clear(); return this.generation; }
    constructor(private root: ParentNode) {
        if(root instanceof Node) {
            this.observer = new MutationObserver(() => this.clear());
            this.observer.observe(root, { childList: true, subtree: true });
        }
    }
    geometry(node: SVGElement, id: string): SVGElement[] { return this.get(node, 'geometry', () => geometryRoleNodes(this.root, node, id)); }
    reveal(node: SVGElement, id: string): SVGElement[] { return this.get(node, 'reveal', () => pathRevealNodes(this.root, node, id)); }
    paint(node: SVGElement, role: 'fill' | 'stroke'): SVGElement[] { return this.get(node, role, () => paintRoleNodes(node, role)); }
    query(node: SVGElement, selector: string): SVGElement[] { return this.get(node, selector, () => Array.from(node.querySelectorAll<SVGElement>(selector))); }
    clear(): void { this.generation++; this.cache = new WeakMap(); }
    destroy(): void { this.observer?.disconnect(); this.clear(); }
    private get(node: SVGElement, key: string, query: () => SVGElement[]): SVGElement[] {
        if(this.observer?.takeRecords().length) this.clear();
        let values = this.cache.get(node);
        if(!values) { values = new Map(); this.cache.set(node, values); }
        let result = values.get(key);
        if(!result) { result = query(); values.set(key, result); }
        return result;
    }
}
