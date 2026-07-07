import { AfterViewInit, Component, forwardRef, Input } from "@angular/core";
import { NgFor, NgIf } from "@angular/common";
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from "@angular/forms";

@Component({
    standalone: true,
    selector: 'attr-select',
    imports: [NgFor, NgIf, FormsModule],
    templateUrl: 'select.component.html',
    styleUrls: ['select.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => SelectAttribut),
            multi: true
        }
    ]
})
export class SelectAttribut implements AfterViewInit, ControlValueAccessor {
    @Input('label') label?: string;
    @Input('options') options?: ReadonlyArray<{ label: string; value: any }>;

    val?: any = null;

    constructor() {}

    ngAfterViewInit() {}

    onChange(_value: any) {};
    onTouch(): void {}

    set value(val: any) {
        if (this.val !== val) {
            this.val = val;
            this.onTouch();
            this.onChange(this.val);
        }
    }

    get value() {
        return this.val;
    }

    writeValue(_value?: any) {
        this.val = _value ?? null;
    }

    registerOnChange(fn: (_v: any) => {}) {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => {}) {
        this.onTouch = fn;
    }
}
