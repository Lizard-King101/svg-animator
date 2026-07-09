export interface MotionSave {
    pathId?: string | null;
    progress?: number;
    offsetX?: number;
    offsetY?: number;
    rotateToPath?: boolean;
    offsetAngle?: number;
}

export interface MotionState {
    pathId?: string | null;
    progress: number;
    offsetX: number;
    offsetY: number;
    rotateToPath: boolean;
    offsetAngle: number;
}

export function defaultMotion(): MotionState {
    return {
        pathId: null,
        progress: 0,
        offsetX: 0,
        offsetY: 0,
        rotateToPath: false,
        offsetAngle: 0,
    };
}

export function restoreMotion(save?: MotionSave | null): MotionState {
    return {
        pathId: typeof save?.pathId === "string" ? save.pathId : null,
        progress: clamp01(save?.progress ?? 0),
        offsetX: finite(save?.offsetX, 0),
        offsetY: finite(save?.offsetY, 0),
        rotateToPath: save?.rotateToPath ?? false,
        offsetAngle: finite(save?.offsetAngle, 0),
    };
}

export function serializeMotion(motion: MotionState): MotionSave | undefined {
    if(!motion.pathId) {
        return undefined;
    }

    return {
        pathId: motion.pathId,
        progress: round(clamp01(motion.progress)),
        offsetX: round(motion.offsetX),
        offsetY: round(motion.offsetY),
        rotateToPath: motion.rotateToPath,
        offsetAngle: round(motion.offsetAngle),
    };
}

function finite(value: unknown, fallback: number): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}
