import { Directive, ElementRef, forwardRef, HostListener, Input } from "@angular/core";
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from "@angular/forms";

const DEFAULT_DECIMALS = 2;

/**
 * Numeric `ngModel` input that displays rounded values and never writes a partial draft.
 *
 * Empty or invalid drafts are not emitted, so clearing a field to retype it leaves the model
 * unchanged. Model updates that only differ from the typed draft by display precision do not
 * rewrite the field mid-typing. Enter and blur restore the formatted model value; Escape restores
 * the value the field had when it was focused and leaves the field.
 */
@Directive({
    selector: "input[type=number][numberField]",
    standalone: true,
    providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => NumberFieldDirective), multi: true }],
})
export class NumberFieldDirective implements ControlValueAccessor {
    private digits = DEFAULT_DECIMALS;
    private value: number | null = null;
    private focusValue: number | null = null;
    private focused = false;
    private onChange: (value: number) => void = () => {};
    private onTouched: () => void = () => {};

    /** Maximum displayed decimal places; the bare attribute uses the default. */
    @Input() set numberField(decimals: number | string | null | undefined) {
        const parsed = Number(decimals);
        this.digits = decimals === "" || decimals == null || !Number.isInteger(parsed) || parsed < 0 ? DEFAULT_DECIMALS : parsed;
        this.render();
    }

    constructor(private host: ElementRef<HTMLInputElement>) {}

    writeValue(value: unknown): void {
        this.value = typeof value === "number" && Number.isFinite(value) ? value : null;
        if(this.focused && this.draftMatches(this.value)) return;
        this.render();
    }

    registerOnChange(fn: (value: number) => void): void { this.onChange = fn; }
    registerOnTouched(fn: () => void): void { this.onTouched = fn; }
    setDisabledState(disabled: boolean): void { this.host.nativeElement.disabled = disabled; }

    @HostListener("focus") handleFocus(): void {
        this.focused = true;
        this.focusValue = this.value;
    }

    @HostListener("input") handleInput(): void {
        const draft = this.draft();
        if(draft == null) return;
        this.value = draft;
        this.onChange(draft);
    }

    @HostListener("blur") handleBlur(): void {
        this.focused = false;
        this.focusValue = null;
        this.render();
        this.onTouched();
    }

    @HostListener("keydown.enter") handleEnter(): void {
        this.render();
    }

    @HostListener("keydown.escape", ["$event"]) handleEscape(event: Event): void {
        const original = this.focusValue;
        if(original == null) return;
        event.preventDefault();
        event.stopPropagation();
        if(this.value !== original) {
            this.value = original;
            this.onChange(original);
        }
        this.host.nativeElement.blur();
        this.render();
    }

    private draft(): number | null {
        const raw = this.host.nativeElement.value.trim();
        if(raw === "") return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
    }

    private draftMatches(value: number | null): boolean {
        const draft = this.draft();
        if(draft == null || value == null) return false;
        return Math.abs(draft - value) < 0.5 * 10 ** -this.digits;
    }

    private render(): void {
        this.host.nativeElement.value = this.value == null ? "" : formatNumberField(this.value, this.digits);
    }
}

/** Formats a number for a field, trimming float noise and trailing zeros. */
export function formatNumberField(value: number, decimals = DEFAULT_DECIMALS): string {
    const rounded = Number(value.toFixed(decimals));
    return String(Object.is(rounded, -0) ? 0 : rounded);
}
