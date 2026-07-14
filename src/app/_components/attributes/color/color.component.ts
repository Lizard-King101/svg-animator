import { AfterViewInit, Component, forwardRef, Input } from "@angular/core";
import { NgIf, NgStyle } from "@angular/common";
import { ControlValueAccessor, FormsModule, NG_VALUE_ACCESSOR } from "@angular/forms";
import { cloneColor, Color, HSL, RGB } from "src/app/editor/objects/color.object";

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
        this.color.preferredSpace = 'rgb';
        this.rgb = this.color.rgb;
        this.hsl = this.color.hsl;
        this.emitChange();
    }

    updateHSL() {
        this.color.preferredSpace = 'hsl';
        this.color.hsl = this.hsl;
        this.rgb = this.color.rgb;
        this.emitChange();
    }

    updateRGB() {
        this.color.preferredSpace = 'rgb';
        this.color.rgb = this.rgb;
        this.hsl = this.color.hsl;
        this.emitChange();
    }

    updateAlpha() {
        this.color.alpha = Math.max(0, Math.min(1, Number(this.color.alpha)));
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
            const preferredSpace = _value.preferredSpace ?? 'rgb';
            const sameCoordinates = preferredSpace === "hsl"
                ? hslMatches(this.hsl, _value.hsl)
                : rgbMatches(this.rgb, _value.rgb);
            if(this.color.hex === _value.hex && Math.abs(this.color.alpha - _value.alpha) < 0.0001
                && this.color.preferredSpace === preferredSpace && sameCoordinates) {
                return;
            }

            this.color = cloneColor(_value);
            this.rgb = this.color.rgb;
            this.hsl = this.color.hsl;
        } else {
            this.color = new Color();
            this.rgb = this.color.rgb;
            this.hsl = this.color.hsl;
        }
    }

    registerOnChange(fn: (_v: Color) => void) {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => {}) {
        this.onTouch = fn;
    }
}

function rgbMatches(a: RGB, b: RGB): boolean {
    return a.r === b.r && a.g === b.g && a.b === b.b;
}

function hslMatches(a: HSL, b: HSL): boolean {
    return a.h === b.h && a.s === b.s && a.l === b.l;
}
