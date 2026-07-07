import { AfterViewInit, Component, forwardRef, Input } from "@angular/core";
import { NgIf, NgStyle } from "@angular/common";
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from "@angular/forms";
import { Color, HSL, RGB } from "src/app/editor/objects/color.object";

@Component({
    standalone: true,
    selector: 'color',
    imports: [NgIf, NgStyle, FormsModule],
    templateUrl: 'color.component.html',
    styleUrls: ['color.component.scss'],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => ColorAttribute),
            multi: true
        }
    ]
})
export class ColorAttribute implements AfterViewInit, ControlValueAccessor {
    @Input('label') label?: string;
    editType: 'rgbs' | 'rgbp' | 'hsl' = 'hsl';

    color: Color;

    rgb: RGB;
    hsl: HSL;

    constructor() {
        this.color = new Color();
        this.rgb = this.color.rgb;
        this.hsl = this.color.hsl;
    }

    updateHEX() {
        this.rgb = this.color.rgb;
        this.hsl = this.color.hsl;
        this.emitChange();
    }

    updateHSL() {
        this.color.hsl = this.hsl;
        this.rgb = this.color.rgb;
        this.emitChange();
    }

    updateRGB() {
        this.color.rgb = this.rgb;
        this.hsl = this.color.hsl;
        this.emitChange();
    }

    ngAfterViewInit() {}

    onChange(_value: Color) {};
    onTouch(): void {}

    private emitChange() {
        this.onTouch();
        this.onChange(this.color);
    }

    writeValue(_value: Color | null) {
        if (_value) {
            this.color = _value;
            this.rgb = this.color.rgb;
            this.hsl = this.color.hsl;
        } else {
            this.color = new Color();
            this.rgb = this.color.rgb;
            this.hsl = this.color.hsl;
        }
    }

    registerOnChange(fn: (_v: Color) => {}) {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => {}) {
        this.onTouch = fn;
    }
}
