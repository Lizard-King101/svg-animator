import { Component } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormsModule } from "@angular/forms";
import { formatNumberField, NumberFieldDirective } from "./number-field.directive";

@Component({
    standalone: true,
    imports: [FormsModule, NumberFieldDirective],
    template: `<input type="number" numberField [ngModel]="value" (ngModelChange)="changes.push($event); value = $event + drift" />`,
})
class HostComponent {
    value = 79.99999999999591;
    drift = 0;
    changes: number[] = [];
}

describe("NumberFieldDirective", () => {
    let fixture: ComponentFixture<HostComponent>;
    let host: HostComponent;
    let input: HTMLInputElement;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
        fixture = TestBed.createComponent(HostComponent);
        host = fixture.componentInstance;
        input = fixture.nativeElement.querySelector("input");
        await settle();
    });

    afterEach(() => TestBed.resetTestingModule());

    async function settle(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    async function type(value: string): Promise<void> {
        input.value = value;
        input.dispatchEvent(new Event("input"));
        await settle();
    }

    function key(name: string): KeyboardEvent {
        const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
        input.dispatchEvent(event);
        return event;
    }

    it("formats float noise and trailing zeros for display", () => {
        expect(input.value).toBe("80");
        expect(formatNumberField(132.31999999, 2)).toBe("132.32");
        expect(formatNumberField(0.16488233024691357, 3)).toBe("0.165");
        expect(formatNumberField(-0.0001)).toBe("0");
    });

    it("does not emit empty or partial drafts, and restores the model on blur", async () => {
        input.dispatchEvent(new Event("focus"));
        await type("");
        expect(host.changes).toEqual([]);
        expect(input.value).toBe("");

        input.dispatchEvent(new Event("blur"));
        await settle();
        expect(input.value).toBe("80");
    });

    it("keeps the typed draft while the model differs only by display precision", async () => {
        host.drift = 1e-9;
        input.dispatchEvent(new Event("focus"));
        await type("246.3");
        expect(host.changes).toEqual([246.3]);
        expect(input.value).toBe("246.3");

        key("Enter");
        expect(input.value).toBe("246.3");
    });

    it("reverts to the focus-time value on Escape and consumes the key", async () => {
        input.focus();
        input.dispatchEvent(new Event("focus"));
        await type("12");
        const escape = key("Escape");
        await settle();

        expect(escape.defaultPrevented).toBeTrue();
        expect(host.changes).toEqual([12, 79.99999999999591]);
        expect(input.value).toBe("80");
    });

    it("leaves Escape alone when the field is not being edited", () => {
        expect(key("Escape").defaultPrevented).toBeFalse();
        expect(host.changes).toEqual([]);
    });
});
