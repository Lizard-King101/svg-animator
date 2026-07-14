import { ChangeDetectionStrategy, Component, HostBinding, HostListener, Output, ViewEncapsulation } from "@angular/core";
import { TimelineEditingService } from "../../_services/timeline-editing.service";
import { TimelineEditorService } from "../../_services/timeline-editor.service";
import { TimelineToolbarComponent } from "../timeline-toolbar/timeline-toolbar.component";
import { TimelineDopeSheetComponent } from "../timeline-dope-sheet/timeline-dope-sheet.component";

@Component({
    standalone: true,
    selector: "animation-timeline",
    imports: [TimelineToolbarComponent, TimelineDopeSheetComponent],
    templateUrl: "animation-timeline.component.html",
    styleUrls: ["animation-timeline.component.scss"],
    providers: [TimelineEditingService, TimelineEditorService],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class AnimationTimelineComponent {
    @Output() readonly animationChange;
    @HostBinding("style.flex-basis.px") get timelineHeight(): number { return this.timeline.timelineHeight; }
    @HostBinding("class.resizing") get resizingTimeline(): boolean { return this.timeline.resizingTimeline; }
    @HostBinding("class.dragging-keyframe") get draggingKeyframe(): boolean { return this.timeline.draggingKeyframe; }
    @HostBinding("class.dragging-number") get draggingNumber(): boolean { return this.timeline.draggingNumber; }
    @HostBinding("class.selecting-keyframes") get selectingKeyframes(): boolean { return this.timeline.selectingKeyframes; }
    @HostBinding("class.panning-timeline") get panningTimeline(): boolean { return this.timeline.panningTimeline; }
    @HostBinding("class.paint-popover-open") get paintPopoverOpen(): boolean { return !!this.timeline.openColorEditorKey; }

    constructor(public timeline: TimelineEditorService) {
        this.animationChange = timeline.animationChange;
    }

    @HostListener("document:click")
    closePopovers(): void { this.timeline.closeColorEditor(); }

    @HostListener("window:resize")
    closePopoversOnResize(): void { this.timeline.closeColorEditor(); }

    @HostListener("document:keydown", ["$event"])
    handleShortcut(event: KeyboardEvent): void { this.timeline.handleTimelineShortcut(event); }
}
