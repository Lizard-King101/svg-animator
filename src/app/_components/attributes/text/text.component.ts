import { Component, forwardRef, Input } from "@angular/core";
import { NgIf } from "@angular/common";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";

@Component({
    standalone: true,
    selector: 'attr-text',
    imports: [NgIf],
    templateUrl: 'text.component.html',
    styleUrls: ['text.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => TextAttribute),
            multi: true
        }
    ]
})
export class TextAttribute implements ControlValueAccessor {
    @Input() label?: string;
    value = '';

    onChange(_: string) {}
    onTouch() {}

    update(v: string) {
        this.value = v;
        this.onChange(v);
    }

    writeValue(v: string) { this.value = v ?? ''; }
    registerOnChange(fn: any) { this.onChange = fn; }
    registerOnTouched(fn: any) { this.onTouch = fn; }
}
