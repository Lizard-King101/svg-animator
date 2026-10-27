/** Mounted timeline nodes, shared by playback and seeks. Structural changes invalidate
 * references, while scale/domain datasets stay live (zoom need not remount the view).
 */
export class PlaybackTimelineView {
    private nodes?: { playheads: HTMLElement[]; graphs: SVGLineElement[]; input: HTMLInputElement | null };
    private readonly observer: MutationObserver;
    constructor(private readonly root: Document) {
        this.observer = new MutationObserver(() => this.nodes = undefined);
        this.observer.observe(root, { childList: true, subtree: true });
    }
    update(time: number): void {
        if(this.observer.takeRecords().length) this.nodes = undefined;
        const nodes = this.nodes ??= {
            playheads: Array.from(this.root.querySelectorAll<HTMLElement>('.animation-playhead')),
            graphs: Array.from(this.root.querySelectorAll<SVGLineElement>('.animation-graph-playhead')),
            input: this.root.querySelector<HTMLInputElement>('.timeline-current-time'),
        };
        const position = (node: HTMLElement | SVGLineElement) => Number(node.dataset['timePadding'] ?? 28)
            + (time - Number(node.dataset['domainStart'] ?? 0)) * Number(node.dataset['pixelsPerSecond'] ?? 120);
        for(const node of nodes.playheads) node.style.left = `${position(node)}px`;
        for(const node of nodes.graphs) {
            const value = String(position(node));
            if(node.getAttribute('x1') !== value) { node.setAttribute('x1', value); node.setAttribute('x2', value); }
        }
        if(nodes.input && this.root.activeElement !== nodes.input) nodes.input.value = String(Math.round(time * 1000) / 1000);
    }
    destroy(): void { this.observer.disconnect(); this.nodes = undefined; }
}
