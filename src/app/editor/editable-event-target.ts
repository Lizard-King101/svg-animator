/** Returns whether a keyboard event belongs to a control that owns text editing. */
export function isEditableEventTarget(target: EventTarget | null): boolean {
    if(!(target instanceof Element)) return false;
    if(target.closest("input, textarea, select")) return true;

    const contentEditableHost = target.closest("[contenteditable]");
    return contentEditableHost != null && contentEditableHost.getAttribute("contenteditable") !== "false";
}
