import { ElementRef, NgZone } from "@angular/core";
import { AnimationPlaybackService } from "../_services/animation-playback.service";
import { PlaybackPointerGuardDirective } from "./playback-pointer-guard.directive";

describe("PlaybackPointerGuardDirective", () => {
    it("suppresses high-frequency move handlers only while playback is active", () => {
        const host = document.createElement("div");
        const child = document.createElement("div");
        host.appendChild(child);
        const animation = { playing: false } as AnimationPlaybackService;
        const zone = { runOutsideAngular: (callback: () => void) => callback() } as NgZone;
        const directive = new PlaybackPointerGuardDirective(new ElementRef(host), zone, animation);
        let moves = 0;
        let clicks = 0;
        child.addEventListener("pointermove", () => moves++);
        child.addEventListener("mousemove", () => moves++);
        child.addEventListener("click", () => clicks++);
        directive.ngOnInit();

        child.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
        child.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        expect(moves).toBe(2);
        child.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(clicks).toBe(1);

        animation.playing = true;
        child.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }));
        child.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        expect(moves).toBe(2);

        directive.ngOnDestroy();
        child.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
        expect(moves).toBe(3);
    });
});
