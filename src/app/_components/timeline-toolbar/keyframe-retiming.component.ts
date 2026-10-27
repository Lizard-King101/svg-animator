import { Component, DoCheck, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { NgIf } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TimelineEditorService } from '../../_services/timeline-editor.service';
import { RetimeOperation, RetimePivot } from '../../editor/animation/keyframe-retiming';

@Component({
    selector: 'app-keyframe-retiming', standalone: true, imports: [NgIf, FormsModule],
    styles: [`:host { display:flex; align-items:center; flex-wrap:wrap; gap:6px; }
        form { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0; }
        label { display:flex; align-items:center; gap:4px; margin:0; }
        button, input, select { color:var(--text-primary); background:var(--bg-base); border:1px solid var(--border); border-radius:var(--radius-sm); padding:3px 6px; }
        input { width:64px; } button:disabled { opacity:.45; } .hint { color:var(--text-muted); }`],
    template: `<button #toggle type="button" [disabled]="timeline.retimeSelection.end <= timeline.retimeSelection.start"
        [attr.aria-expanded]="open" (click)="togglePanel()">Retime keys</button>
      <form *ngIf="open" (ngSubmit)="apply('scale')" (keydown.escape)="cancel($event)">
        <span>{{timeline.retimeSelection.count}} keys · {{timeline.retimeSelection.start}}–{{timeline.retimeSelection.end}}s</span>
        <label>Duration % <input type="number" name="percent" aria-label="Key duration percentage" min="0.01" step="any" required [(ngModel)]="percent" /></label>
        <label>Anchor <select name="pivot" aria-label="Retiming anchor" [(ngModel)]="pivot">
          <option value="start">Start</option><option value="center">Center</option><option value="end">End</option><option value="playhead">Playhead</option>
        </select></label>
        <button type="submit" [disabled]="!!scaleProblem || percent === 100" [title]="scaleProblem || '200% takes twice as long; 50% takes half as long'">Apply timing</button>
        <button type="button" [disabled]="!!reverseProblem" [title]="reverseProblem || 'Reverse the selected time range. Holds stay stepped in the new key order.'" (click)="apply('reverse')">Reverse keys</button>
        <button type="button" (click)="cancel()">Cancel</button>
        <span class="hint" role="status">{{scaleProblem || reverseProblem || '0.01s grid · Holds stay stepped · Duration stays unchanged'}}</span>
      </form>`,
})
export class KeyframeRetimingComponent implements DoCheck, OnDestroy {
    @ViewChild('toggle') toggle?: ElementRef<HTMLButtonElement>;
    open = false;
    percent: number | null = 100;
    pivot: RetimePivot = 'start';
    private signature = '';
    private context: unknown;
    private revision = 0;
    private subscription;
    constructor(public timeline: TimelineEditorService) {
        this.subscription = timeline.animation.contextChanging.subscribe(() => this.close());
    }
    ngOnDestroy(): void { this.subscription.unsubscribe(); }
    ngDoCheck(): void {
        if(this.open && (this.context !== this.timeline.activeAnimation || this.revision !== this.timeline.animation.revision
            || this.signature !== this.timeline.retimeSelection.signature)) this.close();
    }
    togglePanel(): void {
        if(this.open) { this.cancel(); return; }
        this.timeline.animation.pause?.();
        this.percent = 100; this.pivot = 'start';
        this.context = this.timeline.activeAnimation; this.revision = this.timeline.animation.revision;
        this.signature = this.timeline.retimeSelection.signature; this.open = true;
    }
    private operation(kind: 'scale' | 'reverse'): RetimeOperation {
        return kind === 'reverse' ? { kind } : { kind, factor: (this.percent ?? 0) / 100, pivot: this.pivot, playhead: this.timeline.animation.currentTime };
    }
    get scaleProblem(): string { return this.timeline.planSelectedKeyRetime(this.operation('scale')).problem ?? ''; }
    get reverseProblem(): string { return this.timeline.planSelectedKeyRetime(this.operation('reverse')).problem ?? ''; }
    apply(kind: 'scale' | 'reverse'): void {
        this.ngDoCheck();
        if(!this.open) return;
        const operation = this.operation(kind);
        if(this.timeline.planSelectedKeyRetime(operation).problem) return;
        this.timeline.retimeSelectedKeys(operation); this.cancel();
    }
    cancel(event?: Event): void { event?.preventDefault(); event?.stopPropagation(); this.close(); this.toggle?.nativeElement.focus(); }
    private close(): void { this.open = false; this.percent = 100; }
}
