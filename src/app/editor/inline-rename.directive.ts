import { AfterViewInit, Directive, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output } from '@angular/core';

export interface InlineRenameResult { value?: string; restoreFocus: boolean; }

/** Native text drafts must not re-evaluate the entire scene on each typing event. */
@Directive({ selector: 'input[inlineRename]', standalone: true })
export class InlineRenameDirective implements AfterViewInit, OnDestroy {
    @Input() inlineRename = '';
    @Output() renameComplete = new EventEmitter<InlineRenameResult>();
    private completed = false;
    private listeners: (() => void)[] = [];

    constructor(private host: ElementRef<HTMLInputElement>, private zone: NgZone) {}

    ngAfterViewInit(): void {
        const input = this.host.nativeElement;
        input.value = this.inlineRename;
        this.zone.runOutsideAngular(() => {
            const listen = (type: string, listener: EventListener) => {
                input.addEventListener(type, listener);
                this.listeners.push(() => input.removeEventListener(type, listener));
            };
            // Preserve native typing, selection, clipboard and IME behavior without bubbling to
            // Angular row/document listeners. Only completion returns to the editor's zone.
            for(const type of ['input', 'keyup', 'keypress', 'click', 'dblclick', 'mousedown', 'mouseup',
                'pointerdown', 'pointerup', 'pointermove', 'copy', 'cut', 'paste']) {
                listen(type, event => event.stopPropagation());
            }
            listen('keydown', event => {
                event.stopPropagation();
                const key = event as KeyboardEvent;
                if(key.isComposing || key.keyCode === 229 || !['Enter', 'Escape'].includes(key.key)) return;
                event.preventDefault();
                this.finish(key.key === 'Escape' ? undefined : input.value, true);
            });
            listen('blur', () => this.finish(input.value, false));
            input.focus();
            input.select();
        });
    }

    ngOnDestroy(): void {
        this.completed = true;
        this.listeners.splice(0).forEach(remove => remove());
    }

    private finish(value: string | undefined, restoreFocus: boolean): void {
        if(this.completed) return;
        this.completed = true;
        this.zone.run(() => this.renameComplete.emit({ value, restoreFocus }));
    }
}
