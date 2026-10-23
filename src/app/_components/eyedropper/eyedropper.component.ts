import { Component, Directive, DoCheck, ElementRef, HostListener, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgIf } from '@angular/common';
import { EyedropperService, SamplingSource } from '../../_services/eyedropper.service';

@Directive({ selector: '[eyedropperSurface]', standalone: true })
export class EyedropperSurfaceDirective implements OnInit, OnDestroy {
    constructor(private host: ElementRef<SVGSVGElement>, private eyedropper: EyedropperService) {}
    ngOnInit(): void { this.eyedropper.register(this.host.nativeElement); }
    ngOnDestroy(): void { this.eyedropper.unregister(this.host.nativeElement); }
}

@Component({
    selector: 'app-eyedropper', standalone: true, imports: [NgIf],
    template: `
      <div *ngIf="picker.active()" #shield class="sampling-shield" role="dialog" aria-modal="true" aria-label="Pick a color" tabindex="-1"
        (pointermove)="move($event)" (mousemove)="$event.stopPropagation()" (mousedown)="$event.stopPropagation()"
        (pointerdown)="$event.stopPropagation()" (pointercancel)="picker.cancel()" (click)="pick($event)"
        (keydown)="key($event)" (contextmenu)="$event.preventDefault(); $event.stopPropagation(); picker.cancel()">
        <div class="sampling-toolbar" (pointermove)="$event.stopPropagation()" (click)="$event.stopPropagation()">
          <strong>Eyedropper</strong>
          <button type="button" class="btn btn-sm btn-secondary" [attr.aria-pressed]="picker.source === 'artwork'" (click)="switchSource('artwork')">Artwork</button>
          <button type="button" class="btn btn-sm btn-secondary" [disabled]="!picker.referenceAvailable" [attr.aria-pressed]="picker.source === 'reference'" (click)="switchSource('reference')">Reference</button>
          <button type="button" class="btn btn-sm btn-secondary" (click)="picker.cancel()">Cancel</button>
          <span role="status">{{ picker.error() || (picker.busy() ? 'Preparing sample…' : picker.source === 'reference' ? 'Original image colors · tracing opacity ignored' : 'Visible canvas colors') }}</span>
          <small>Click or Enter to pick · Arrows to move · Escape to cancel</small>
        </div>
        <div *ngIf="picker.pointer as pointer" class="sample-preview" [style.left.px]="previewX" [style.top.px]="previewY" aria-live="polite">
          <ng-container *ngIf="picker.sample() as sample; else empty">
            <div class="magnifier"><img [src]="sample.preview" alt="Magnified color sample"><i></i></div>
            <span [style.background]="sample.color.serialized" class="chip"></span>{{ sample.color.serialized }}
          </ng-container>
          <ng-template #empty>{{ picker.busy() ? 'Loading…' : 'No sample here' }}</ng-template>
        </div>
      </div>`,
    styles: `:host { display:contents; } .sampling-shield { position:fixed; inset:0; z-index:2000; cursor:crosshair; outline:none; }
      .sampling-toolbar { position:absolute; top:12px; left:50%; transform:translateX(-50%); display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px;
        width:max-content; max-width:calc(100% - 24px); padding:10px; background:var(--bg-surface); color:var(--text-primary); border:1px solid var(--border); border-radius:var(--radius-md); cursor:default; }
      .sampling-toolbar span, .sampling-toolbar small { width:100%; text-align:center; font-size:11px; color:var(--text-secondary); }
      button[aria-pressed=true] { outline:2px solid var(--accent); }
      .sample-preview { position:absolute; pointer-events:none; background:var(--bg-surface); color:var(--text-primary); padding:8px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:11px; }
      .magnifier { position:relative; width:110px; height:110px; margin-bottom:6px; background:repeating-conic-gradient(#888 0% 25%, #fff 0% 50%) 0 / 10px 10px; }
      .magnifier img { display:block; width:100%; height:100%; image-rendering:pixelated; } .magnifier i { position:absolute; left:50px; top:50px; width:10px; height:10px; outline:1px solid white; box-shadow:0 0 0 2px black; }
      .chip { display:inline-block; width:12px; height:12px; margin-right:5px; border:1px solid var(--border); }`,
})
export class EyedropperComponent implements DoCheck {
    private shield?: HTMLElement;
    @ViewChild('shield') set samplingShield(ref: ElementRef<HTMLElement> | undefined) { this.shield = ref?.nativeElement; this.shield?.focus({ preventScroll: true }); }
    constructor(public picker: EyedropperService) {}
    get previewX(): number { return Math.max(0, Math.min((this.picker.pointer?.x ?? 0) + 18, innerWidth - 160)); }
    get previewY(): number { return Math.max(0, Math.min((this.picker.pointer?.y ?? 0) + 18, innerHeight - 160)); }
    ngDoCheck(): void { this.picker.validate(); }
    switchSource(source: SamplingSource): void { void this.picker.setSource(source); this.shield?.focus({ preventScroll: true }); }
    @HostListener('window:blur') blur(): void { if(this.picker.active()) this.picker.cancel(); }
    move(event: PointerEvent): void { event.stopPropagation(); this.picker.move(event.clientX, event.clientY); }
    pick(event: MouseEvent): void { event.stopPropagation(); if(event.button !== 0) return; this.picker.move(event.clientX, event.clientY); this.picker.choose(); }
    key(event: KeyboardEvent): void {
        event.stopPropagation();
        if(event.key === 'Escape') { event.preventDefault(); this.picker.cancel(); return; }
        if(event.key === 'Tab') {
            event.preventDefault();
            const buttons = Array.from(this.shield?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = index < 0 ? (event.shiftKey ? buttons.length - 1 : 0)
                : (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next]?.focus(); return;
        }
        if(event.target instanceof HTMLButtonElement) return;
        if(event.key === 'Enter') { event.preventDefault(); this.picker.choose(); return; }
        const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        const direction = directions[event.key];
        if(direction) { event.preventDefault(); this.picker.nudge(direction[0] * (event.shiftKey ? 10 : 1), direction[1] * (event.shiftKey ? 10 : 1)); }
    }
}
