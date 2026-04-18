import { Component, forwardRef, Input } from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";
import { NgClass } from "@angular/common";

@Component({
    standalone: true,
    selector: 'attr-bool',
    imports: [NgClass],
    templateUrl: 'bool.component.html',
    styleUrls: ['bool.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => BoolAttribute),
            multi: true
        }
    ]
})
export class BoolAttribute implements ControlValueAccessor {
    @Input() label?: string;
    value = false;

    onChange(_: boolean) {}
    onTouch() {}

    toggle() {
        this.value = !this.value;
        this.onChange(this.value);
    }

    writeValue(v: boolean) { this.value = !!v; }
    registerOnChange(fn: any) { this.onChange = fn; }
    registerOnTouched(fn: any) { this.onTouch = fn; }
}
