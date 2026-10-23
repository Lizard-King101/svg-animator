import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy } from "@angular/core";
import { AnimationGestureService } from "../../_services/animation-gesture.service";
import { DocumentMutationService } from "../../_services/document-mutation.service";
import { EditorService } from "../../_services/editor.service";
import { Point } from "../../editor/objects/point.object";

@Component({
    selector: "app-canvas-workspace",
    standalone: true,
    template: '<ng-content />',
})
export class CanvasWorkspaceComponent implements AfterViewInit, OnDestroy {
    private readonly listeners = new AbortController();
    private movingView = false;
    private activeButton?: number;
    private moveStart = new Point(0, 0);

    get element(): HTMLElement { return this.host.nativeElement; }

    constructor(
        private editor: EditorService,
        private mutations: DocumentMutationService,
        private zone: NgZone,
        private host: ElementRef<HTMLElement>,
        private animationGestures: AnimationGestureService,
    ) {}

    ngAfterViewInit(): void {
        const viewport = this.element;
        const signal = this.listeners.signal;

        viewport.addEventListener("mousedown", (event) => this.zone.run(() => {
            this.editor.closeContextMenu();
            if(event.button !== 0 && event.button !== 1) return;
            this.activeButton = event.button;
            const start = this.editor.toViewportPoint(event.x, event.y);
            if(event.button === 0 && this.editor.selectedTool) {
                this.editor.selectedTool.down(event);
                this.animationGestures.begin();
            } else if(event.button === 1) {
                this.movingView = true;
                this.moveStart = start;
            }
        }), { signal });

        document.addEventListener("mouseup", (event) => this.zone.run(() => {
            if(event.button !== this.activeButton) return;
            this.activeButton = undefined;
            const wasMovingView = this.movingView;
            if(!wasMovingView) {
                this.editor.selectedTool?.up(event);
                this.animationGestures.end();
                if(!viewport.contains(event.target as Node)) this.editor.selectedTool?.leave();
            }
            this.movingView = false;
            if(wasMovingView && this.editor.selectedSVG) this.editor.rememberCanvasView(this.editor.selectedSVG);
            if(event.button !== 2) this.mutations.commit();
        }), { signal });

        viewport.addEventListener("wheel", (event) => this.zone.run(() => {
            this.editor.closeContextMenu();
            const svg = this.editor.selectedSVG;
            if(!svg) return;
            const oldZoom = svg.zoom;
            const step = oldZoom * 0.1;
            const newZoom = Math.max(0.05, event.deltaY > 0 ? oldZoom - step : oldZoom + step);
            const rect = viewport.getBoundingClientRect();
            const vx = event.clientX - rect.left;
            const vy = event.clientY - rect.top;
            const renderedLeft = svg.pos.x + svg.width * (1 - oldZoom) / 2;
            const renderedTop = svg.pos.y + svg.height * (1 - oldZoom) / 2;
            const nextLeft = vx - (vx - renderedLeft) * newZoom / oldZoom;
            const nextTop = vy - (vy - renderedTop) * newZoom / oldZoom;
            svg.pos.x = nextLeft - svg.width * (1 - newZoom) / 2;
            svg.pos.y = nextTop - svg.height * (1 - newZoom) / 2;
            this.editor.setZoom(svg, newZoom);
        }), { passive: true, signal });

        viewport.addEventListener("contextmenu", (event) => this.zone.run(() => {
            event.preventDefault();
            this.editor.selectedTool?.contextMenu(event);
            this.mutations.commit();
        }), { signal });

        this.zone.runOutsideAngular(() => document.addEventListener("mousemove", (event) => {
            if(this.activeButton == null && !viewport.contains(event.target as Node)) return;
            this.zone.run(() => {
                if(this.movingView && this.editor.selectedSVG) {
                    const position = this.editor.toViewportPoint(event.x, event.y);
                    const delta = position.subtract(this.moveStart);
                    this.moveStart.addTo(delta.x, delta.y);
                    this.editor.selectedSVG.pos.addTo(delta);
                }
                this.editor.selectedTool?.drag(event);
            });
        }, { signal }));

        viewport.addEventListener("click", (event) => this.zone.run(() => {
            this.editor.closeContextMenu();
            if(this.editor.selectedTool && event.button === 0) {
                this.editor.selectedTool.click(event);
                this.mutations.commit();
            }
        }), { signal });

        viewport.addEventListener("dblclick", (event) => this.zone.run(() => {
            this.editor.closeContextMenu();
            if(this.editor.selectedTool && event.button === 0) {
                this.editor.selectedTool.doubleClick(event);
                this.mutations.commit();
            }
        }), { signal });

        viewport.addEventListener('mouseleave', () => {
            if(this.activeButton == null) this.zone.run(() => this.editor.selectedTool?.leave());
        }, { signal });
        window.addEventListener('blur', () => this.zone.run(() => {
            this.cancelGesture();
            this.editor.selectedTool?.leave();
        }), { signal });
        document.addEventListener('keydown', (event) => {
            if(this.activeButton == null) return;
            if(event.key === 'Alt' && this.activeButton === 0) {
                // A modifier may refresh the live move, but only mouseup commits it.
                this.zone.run(() => this.editor.keyPressed(event.key));
                event.preventDefault();
                event.stopImmediatePropagation();
                return;
            }
            if(event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))) {
                this.zone.run(() => this.cancelGesture());
                if(event.key === 'Escape') {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }
        }, { signal, capture: true });
        document.addEventListener('keyup', (event) => {
            if(this.activeButton !== 0 || event.key !== 'Alt') return;
            this.zone.run(() => this.editor.keyReleased(event.key));
            event.preventDefault();
            event.stopImmediatePropagation();
        }, { signal, capture: true });

        this.editor.setViewPort(viewport);
    }

    private cancelGesture(): void {
        if(this.activeButton == null) return;
        this.editor.selectedTool?.reset();
        this.animationGestures.cancel();
        this.activeButton = undefined;
        this.movingView = false;
    }

    ngOnDestroy(): void {
        this.cancelGesture();
        this.listeners.abort();
    }
}
