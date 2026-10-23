import { applyDrawingPaint } from '../editor/objects/drawing-paint';
import { Subscription } from 'rxjs';
import { Injectable, OnDestroy } from '@angular/core';
import { EditorService } from './editor.service';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { LayerOperationsService } from './layer-operations.service';
import { PointSnappingInteraction } from './tools/point-snapping.interaction';
import { ConstructionKind } from './tools/construction.tool';
import { Point } from '../editor/objects/point.object';
import { Path } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { SVG } from '../editor/objects/svg.object';
import { arcToCubics } from '../editor/objects/arc-geometry';

interface Draft {
    svg: SVG;
    kind: ConstructionKind;
    origin: Point;
    sourceOrigin: Point;
    point: Point;
    start?: Point;
    preview: Path;
}

/** Stages construction outside persisted artwork until one completed action. */
@Injectable()
export class ConstructionDrawingService implements OnDestroy {
    private readonly restored: Subscription;
    private snapping = new PointSnappingInteraction(this.editor);
    private draft?: Draft;
    private pointer?: MouseEvent;
    private press?: { x: number; y: number; first: boolean };
    private skipClick = false;
    get guide() { return this.draft ? { origin: this.draft.origin, end: this.draft.start ?? this.draft.point } : undefined; }
    get active(): boolean { return !!this.draft; }
    get pointSnapFeedback() { return this.snapping.feedback; }
    get hint(): string {
        if(this.animation.mode !== 'edit') return 'Switch to Edit to draw construction shapes.';
        if(!this.draft) return 'Line: endpoints · Arc: center, start, end. Click or drag to begin.';
        if(this.draft.kind === 'line') return 'Place the endpoint · Shift: 15° angles · Alt: bypass snapping · Enter: finish · Escape: cancel';
        return this.draft.start ? 'Place the arc end · Shift: long arc · Enter: finish · Escape: cancel'
            : 'Place the arc start and radius · Alt: bypass snapping · Escape: cancel';
    }
    constructor(private editor: EditorService, private animation: AnimationPlaybackService,
        private mutations: DocumentMutationService, private layers: LayerOperationsService) {
        this.restored = mutations.historyRestored.subscribe(() => this.cancel());
    }
    ngOnDestroy(): void { this.restored.unsubscribe(); this.cancel(); }

    validate(): void {
        if(this.draft && (this.draft.svg !== this.editor.selectedSVG || this.animation.mode !== 'edit')) this.cancel();
    }
    down(kind: ConstructionKind, event: MouseEvent): void {
        this.validate();
        const svg = this.editor.selectedSVG;
        if(event.button !== 0 || !svg || this.animation.mode !== 'edit') return;
        this.skipClick = false;
        if(this.draft?.kind !== kind) this.cancel();
        const first = !this.draft;
        if(first) {
            this.snapping.begin();
            const origin = this.snapping.update(this.editor.toCanvasPoint(event.clientX, event.clientY), event.altKey);
            const preview = new Path(this.editor);
            applyDrawingPaint(preview.settings, this.editor.drawingPaint, false);
            preview.name = kind === 'line' ? 'Line' : 'Arc';
            this.draft = { svg, kind, origin, sourceOrigin: origin, point: origin, preview };
            svg.tempElements.push(preview);
            this.snapping.begin(undefined, kind === 'line' ? origin : undefined);
        }
        this.press = { x: event.clientX, y: event.clientY, first };
        this.move(event);
    }
    move(event: MouseEvent): void {
        this.validate();
        const draft = this.draft;
        if(!draft) return;
        this.pointer = event;
        const raw = this.editor.toCanvasPoint(event.clientX, event.clientY);
        // Arc endpoints lie on the established radius. Do not show a snap at a
        // different point than the projected end that will actually be committed.
        let point = draft.start ? raw : this.snapping.update(raw, event.altKey || !!this.editor.keysDown['Alt'] || (draft.kind === 'line' && (event.shiftKey || !!this.editor.keysDown['Shift'])));
        if(draft.kind === 'line' && (event.shiftKey || this.editor.keysDown['Shift'])) {
            const dx = raw.x - draft.sourceOrigin.x, dy = raw.y - draft.sourceOrigin.y;
            const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
            const radius = Math.hypot(dx, dy);
            point = new Point(draft.sourceOrigin.x + radius * Math.cos(angle), draft.sourceOrigin.y + radius * Math.sin(angle));
        }
        const contact = this.snapping.feedback?.target?.origin;
        draft.origin = contact ? new Point(contact.x, contact.y) : draft.sourceOrigin;
        draft.point = new Point(point.x, point.y);
        this.render(!!(event.shiftKey || this.editor.keysDown['Shift']));
    }
    up(event: MouseEvent): void {
        const press = this.press;
        this.press = undefined;
        if(!this.draft || !press) return;
        this.move(event);
        if(press.first) {
            if(Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 3) this.advance();
            this.skipClick = true;
        }
    }
    click(event: MouseEvent): void {
        if(this.skipClick) { this.skipClick = false; return; }
        if(!this.draft) return;
        this.move(event);
        this.advance();
    }
    key(key: string): void {
        if(key === 'Escape') this.cancel();
        else if(key === 'Enter') this.advance();
        else if((key === 'Alt' || key === 'Shift') && this.pointer) {
            const event = this.pointer;
            this.move(new MouseEvent('mousemove', { clientX: event.clientX, clientY: event.clientY,
                altKey: !!this.editor.keysDown['Alt'], shiftKey: !!this.editor.keysDown['Shift'] }));
        }
    }
    advance(): void {
        this.validate();
        const draft = this.draft;
        if(!draft || Math.hypot(draft.point.x - draft.origin.x, draft.point.y - draft.origin.y) * draft.svg.zoom < 2) return;
        if(draft.kind === 'arc' && !draft.start) {
            draft.start = new Point(draft.point.x, draft.point.y);
            this.snapping.clear();
            this.render(false);
            return;
        }
        if(!draft.preview.lines.length) return;
        const end = draft.preview.lines.at(-1)!.points[1];
        if(draft.start && Math.hypot(end.x - draft.start.x, end.y - draft.start.y) * draft.svg.zoom < 2) return;
        const element = draft.preview;
        this.cancel();
        this.mutations.mutate(() => {
            this.layers.insertElement(element);
            this.editor.selectedElement = element;
        });
    }
    cancel(): void {
        if(this.draft) this.draft.svg.tempElements = this.draft.svg.tempElements.filter(element => element !== this.draft!.preview);
        this.draft = undefined;
        this.press = undefined;
        this.pointer = undefined;
        this.snapping.clear();
    }
    private render(longArc: boolean): void {
        const draft = this.draft!;
        const { origin, point, preview } = draft;
        if(!draft.start) {
            preview.lines = [new Line(this.editor, { points: [origin, point] })];
        } else {
            const start = draft.start;
            const radius = Math.hypot(start.x - origin.x, start.y - origin.y);
            const endAngle = Math.atan2(point.y - origin.y, point.x - origin.x);
            const startAngle = Math.atan2(start.y - origin.y, start.x - origin.x);
            let sweep = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
            if(Math.abs(sweep) < 1e-6) { preview.lines = []; return; }
            if(longArc) sweep += sweep > 0 ? -2 * Math.PI : 2 * Math.PI;
            const end = new Point(origin.x + radius * Math.cos(endAngle), origin.y + radius * Math.sin(endAngle));
            const cubics = arcToCubics(start.toSave(), end.toSave(), radius, radius, 0, Math.abs(sweep) > Math.PI, sweep > 0, () => this.editor.ID);
            let previous = start;
            preview.lines = cubics.map(segment => {
                const next = Point.fromSave(segment.end);
                const line = new Line(this.editor, { type: 'bezier', points: [previous, next], controlStart: Point.fromSave(segment.controlStart), controlEnd: Point.fromSave(segment.controlEnd) });
                previous = next;
                return line;
            });
        }
    }
}
