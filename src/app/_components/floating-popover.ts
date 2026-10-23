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

export interface PointMenuPosition {
    left: number;
    top: number;
}

/** Places a measured menu at a pointer, opening leftward when requested and keeping it inside the viewport. */
export function positionPointMenu(
    point: { x: number; y: number },
    size: { width: number; height: number },
    opensLeft: boolean,
    viewport: FloatingPopoverViewport = { width: window.innerWidth, height: window.innerHeight },
    margin = 8,
): PointMenuPosition {
    const preferredLeft = opensLeft ? point.x - size.width : point.x;
    return {
        left: Math.max(margin, Math.min(preferredLeft, viewport.width - size.width - margin)),
        top: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
    };
}

/**
 * Places a popover beside its trigger, to the left (clearing `inset` pixels of the trigger's panel), with
 * its top aligned to the trigger and clamped so the whole popover stays in the viewport. Falls back to
 * opening above or below the trigger when there is no room on the left.
 */
export function positionSidePopover(
    anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">,
    options: FloatingPopoverOptions & { inset?: number },
    viewport: FloatingPopoverViewport = { width: window.innerWidth, height: window.innerHeight },
): FloatingPopoverPosition {
    const margin = options.margin ?? 8;
    const left = anchor.left - (options.inset ?? 0) - (options.gap ?? 4) - options.width;
    if(left < margin) return positionFloatingPopover(anchor, options, viewport);
    const maxHeight = Math.max(0, Math.min(options.preferredHeight, viewport.height - margin * 2));
    const top = Math.max(margin, Math.min(anchor.top, viewport.height - margin - maxHeight));
    return { left, top, maxHeight };
}
