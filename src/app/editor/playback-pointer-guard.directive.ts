import { Directive, ElementRef, NgZone, OnDestroy, OnInit } from "@angular/core";
import { AnimationPlaybackService } from "../_services/animation-playback.service";

/** Keeps high-frequency editor move events from triggering view work during imperative playback. */
@Directive({
    selector: "[suppressPointerMovesDuringPlayback]",
    standalone: true,
})
export class PlaybackPointerGuardDirective implements OnInit, OnDestroy {
    private readonly listeners = new AbortController();

    constructor(
        private host: ElementRef<HTMLElement>,
        private zone: NgZone,
        private animation: AnimationPlaybackService,
    ) {}

    ngOnInit(): void {
        this.zone.runOutsideAngular(() => {
            const suppressDuringPlayback = (event: Event) => {
                if(this.animation.playing) event.stopImmediatePropagation();
            };
            const options = { capture: true, passive: true, signal: this.listeners.signal };
            this.host.nativeElement.addEventListener("pointermove", suppressDuringPlayback, options);
            this.host.nativeElement.addEventListener("mousemove", suppressDuringPlayback, options);
        });
    }

    ngOnDestroy(): void {
        this.listeners.abort();
    }
}
