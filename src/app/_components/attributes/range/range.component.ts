import { AfterViewInit, Component, forwardRef, Input } from "@angular/core";
import { NgIf } from "@angular/common";
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from "@angular/forms";

@Component({
    standalone: true,
    selector: 'range',
    imports: [NgIf, FormsModule],
    templateUrl: 'range.component.html',
    styleUrls: ['range.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => RangeAttribute),
            multi: true
        }
    ]
})
export class RangeAttribute implements AfterViewInit, ControlValueAccessor {
    @Input('min') min?: number;
    @Input('max') max?: number;
    @Input('label') label?: string;

    val?: number;

    constructor() {}

    updateValue() {
        this.onTouch();
        if (this.value != undefined) {
            this.onChange(this.value);
        }
    }

    ngAfterViewInit() {}

    onChange(_value: number) {};
    onTouch(): void {}

    set value(val: number) {
        if (val != undefined && this.val !== val) {
            this.val = val;
            this.onTouch();
            this.onChange(this.val);
        }
    }

    get value() {
        if (this.val != undefined) {
            return this.val;
        } else {
            return 0;
        }
    }

    writeValue(_value?: number) {
        this.val = _value ?? 0;
    }

    registerOnChange(fn: (_v: number) => {}) {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => {}) {
        this.onTouch = fn;
    }
}
