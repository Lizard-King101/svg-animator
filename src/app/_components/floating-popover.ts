export interface FloatingPopoverPosition {
    left: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
}

export interface FloatingPopoverViewport {
    width: number;
    height: number;
}

export interface FloatingPopoverOptions {
    width: number;
    preferredHeight: number;
    margin?: number;
    gap?: number;
}

/** Positions a fixed popover against a viewport edge without guessing its rendered height. */
export function positionFloatingPopover(
    anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
    options: FloatingPopoverOptions,
    viewport: FloatingPopoverViewport = { width: window.innerWidth, height: window.innerHeight },
): FloatingPopoverPosition {
    const margin = options.margin ?? 8;
    const gap = options.gap ?? 4;
    const left = Math.max(margin, Math.min(anchor.right - options.width, viewport.width - options.width - margin));
    const spaceBelow = Math.max(0, viewport.height - margin - anchor.bottom - gap);
    const spaceAbove = Math.max(0, anchor.top - margin - gap);
    const openBelow = spaceBelow >= options.preferredHeight || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(options.preferredHeight, openBelow ? spaceBelow : spaceAbove);

    return openBelow
        ? { left, top: anchor.bottom + gap, maxHeight }
        : { left, bottom: viewport.height - anchor.top + gap, maxHeight };
}

export function floatingPopoverStyle(position?: FloatingPopoverPosition): Record<string, string> {
    if(!position) return {};
    return {
        left: `${position.left}px`,
        ...(position.top == null ? {} : { top: `${position.top}px` }),
        ...(position.bottom == null ? {} : { bottom: `${position.bottom}px` }),
        maxHeight: `${position.maxHeight}px`,
    };
}
