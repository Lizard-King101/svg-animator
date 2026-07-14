import { isEditableEventTarget } from "./editable-event-target";

describe("editable event targets", () => {
    it("recognizes native form controls and their descendants", () => {
        const input = document.createElement("input");
        const textarea = document.createElement("textarea");
        const select = document.createElement("select");
        const option = document.createElement("option");
        select.append(option);

        expect(isEditableEventTarget(input)).toBeTrue();
        expect(isEditableEventTarget(textarea)).toBeTrue();
        expect(isEditableEventTarget(select)).toBeTrue();
        expect(isEditableEventTarget(option)).toBeTrue();
    });

    it("recognizes content-editable hosts and their descendants", () => {
        const host = document.createElement("div");
        const child = document.createElement("span");
        host.contentEditable = "true";
        host.append(child);

        expect(isEditableEventTarget(host)).toBeTrue();
        expect(isEditableEventTarget(child)).toBeTrue();
    });

    it("does not classify ordinary or explicitly non-editable elements as editable", () => {
        const ordinary = document.createElement("div");
        const nonEditable = document.createElement("div");
        nonEditable.contentEditable = "false";

        expect(isEditableEventTarget(ordinary)).toBeFalse();
        expect(isEditableEventTarget(nonEditable)).toBeFalse();
        expect(isEditableEventTarget(null)).toBeFalse();
    });
});
