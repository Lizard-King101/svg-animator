import { NgFor, NgIf } from '@angular/common';
import { Component, HostBinding, Input } from '@angular/core';
import { MoveSnapFeedback, featureLabel } from '../../editor/objects/snapping.object';
import { Bounds, Matrix, applyMatrix, transformedBounds } from '../../editor/objects/transform.object';
import { PathSnapCandidate, PointSnapFeedback } from '../../editor/objects/path-snapping';
import { EdgeRotationFeedback } from '../../editor/objects/edge-rotation-snapping';

@Component({
    selector: 'g[snapFeedbackOverlay]',
    standalone: true,
    imports: [NgFor, NgIf],
    template: `
        <svg:rect *ngFor="let target of display.targets" class="snap-target"
            [attr.x]="target.x" [attr.y]="target.y" [attr.width]="target.width" [attr.height]="target.height" />
        <svg:line *ngFor="let line of display.lines" class="snap-line"
            [attr.x1]="line.x1" [attr.y1]="line.y1" [attr.x2]="line.x2" [attr.y2]="line.y2" />
        <svg:g *ngIf="display.marker as marker" [attr.transform]="'translate(' + marker.x + ' ' + marker.y + ')'">
            <svg:circle *ngIf="marker.kind === 'anchor'" class="snap-marker" r="6" />
            <svg:polygon *ngIf="marker.kind === 'midpoint'" class="snap-marker" points="0,-7 7,0 0,7 -7,0" />
            <svg:rect *ngIf="marker.kind === 'path'" class="snap-marker" x="-5" y="-5" width="10" height="10" rx="2" />
            <svg:path *ngIf="marker.kind === 'intersection'" class="snap-marker" d="M -6 -6 L 6 6 M -6 6 L 6 -6" />
            <svg:path *ngIf="marker.kind === 'tangent'" class="snap-marker" d="M -8 4 H 8 M -5 4 A 5 5 0 0 1 5 4" />
            <svg:path *ngIf="marker.kind === 'perpendicular'" class="snap-marker" d="M -7 5 H 7 M 0 5 V -7 M 0 0 H 5 V 5" />
            <svg:circle r="1.5" fill="var(--accent)" />
        </svg:g>
        <svg:g *ngFor="let label of display.labels" [attr.transform]="'translate(' + label.x + ' ' + label.y + ')'">
            <svg:rect class="snap-label-bg" [attr.width]="label.width" height="22" rx="4" />
            <svg:text x="7" y="15">{{ label.text }}</svg:text>
        </svg:g>
    `,
    styles: `
        :host { pointer-events: none; }
        .snap-target, .snap-line { fill: none; stroke: var(--accent); stroke-width: 1; }
        .snap-target { stroke-dasharray: 3 3; opacity: .65; }
        .snap-line { stroke-dasharray: 5 3; }
        .snap-label-bg { fill: var(--bg-surface); stroke: var(--accent); stroke-width: 1; }
        .snap-marker { fill: var(--bg-surface); stroke: var(--accent); stroke-width: 1.5; }
        text { fill: var(--accent); font: 11px system-ui, sans-serif; }
    `,
})
export class SnapFeedbackOverlayComponent {
    @Input({ required: true }) display!: ProjectedSnapFeedback;
    @HostBinding('attr.pointer-events') readonly pointerEvents = 'none';
    @HostBinding('attr.aria-hidden') readonly ariaHidden = 'true';
}

export interface ProjectedSnapFeedback {
    marker?: { x: number; y: number; kind: PathSnapCandidate['kind'] };
    targets: Bounds[];
    lines: Array<{ x1: number; y1: number; x2: number; y2: number }>;
    labels: Array<{ x: number; y: number; width: number; text: string }>;
}

/** Project geometry once; strokes, padding and labels remain in workspace CSS pixels. */
export function projectMoveSnapFeedback(feedback: MoveSnapFeedback, matrix: Matrix, viewport: Bounds, movingLabel?: string): ProjectedSnapFeedback {
    const targets = new Set<Bounds>();
    const moving = transformedBounds(feedback.bounds, matrix);
    const lines = feedback.matches.map(({ candidate }) => {
        if(candidate.target) targets.add(candidate.target);
        const vertical = candidate.axis === 'x';
        const start = applyMatrix(matrix, vertical ? candidate.value : candidate.extent[0], vertical ? candidate.extent[0] : candidate.value);
        const end = applyMatrix(matrix, vertical ? candidate.value : candidate.extent[1], vertical ? candidate.extent[1] : candidate.value);
        return vertical
            ? { x1: start.x, x2: end.x, y1: Math.min(start.y, end.y, moving.y) - 10, y2: Math.max(start.y, end.y, moving.y + moving.height) + 10 }
            : { y1: start.y, y2: end.y, x1: Math.min(start.x, end.x, moving.x) - 10, x2: Math.max(start.x, end.x, moving.x + moving.width) + 10 };
    });
    // Stack relationship labels beside the selection, clamped inside the workspace.
    const top = clamp(moving.y - 30, viewport.y + 6, viewport.y + viewport.height - feedback.matches.length * 26 - 6);
    const labels = feedback.matches.map(({ candidate, feature }, index) => {
        return label(`${movingLabel ?? featureLabel(candidate.axis, feature)} → ${candidate.label}`,
            moving.x + moving.width + 12, top + index * 26, viewport);
    });
    return { targets: [...targets].map((bounds) => transformedBounds(bounds, matrix)), lines, labels };
}

export function projectPointSnapFeedback(feedback: PointSnapFeedback, matrix: Matrix, viewport: Bounds): ProjectedSnapFeedback | undefined {
    if(feedback.guides) return projectMoveSnapFeedback(feedback.guides, matrix, viewport, 'Point');
    const target = feedback.target;
    if(!target) return undefined;
    const point = applyMatrix(matrix, target.point.x, target.point.y);
    return { targets: [], lines: [], marker: { ...point, kind: target.kind },
        labels: [label(target.label, point.x + 14, point.y - 30, viewport)] };
}

export function projectEdgeRotationFeedback(feedback: EdgeRotationFeedback, matrix: Matrix, viewport: Bounds): ProjectedSnapFeedback {
    const lines = [feedback.moving, feedback.reference].map((edge) => {
        const start = applyMatrix(matrix, edge.start.x, edge.start.y), end = applyMatrix(matrix, edge.end.x, edge.end.y);
        return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    });
    const moving = lines[0];
    return { targets: [], lines, labels: [label(`Parallel · ${feedback.reference.label}`,
        (moving.x1 + moving.x2) / 2 + 14, (moving.y1 + moving.y2) / 2 - 30, viewport)] };
}

function label(full: string, x: number, y: number, viewport: Bounds) {
    const maxChars = Math.max(1, Math.min(38, Math.floor((viewport.width - 26) / 7)));
    const text = full.length > maxChars ? full.slice(0, maxChars - 1) + '…' : full;
    const width = text.length * 7 + 14;
    return { x: clamp(x, viewport.x + 6, viewport.x + viewport.width - width - 6),
        y: clamp(y, viewport.y + 6, viewport.y + viewport.height - 28), width, text };
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
