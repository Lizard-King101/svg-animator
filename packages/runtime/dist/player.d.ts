import { RuntimeBundleV1, RuntimeMarkerV1 } from "./contracts";
import { RuntimePlayerError } from "./errors";
export type RuntimePlayerState = "paused" | "playing" | "stopped" | "destroyed";
export type RuntimeMarkerDirection = "forward" | "reverse";
export interface RuntimePlayerEventMap {
    ready: {
        player: RuntimePlayer;
    };
    play: {
        time: number;
    };
    pause: {
        time: number;
    };
    stop: {
        time: number;
    };
    seek: {
        time: number;
        previousTime: number;
    };
    complete: {
        time: number;
    };
    loop: {
        time: number;
        iteration: number;
        direction: RuntimeMarkerDirection;
    };
    marker: {
        marker: RuntimeMarkerV1;
        direction: RuntimeMarkerDirection;
    };
    error: {
        error: RuntimePlayerError;
    };
    destroy: Record<string, never>;
}
export type RuntimePlayerEventType = keyof RuntimePlayerEventMap;
export type RuntimePlayerListener<K extends RuntimePlayerEventType> = (event: RuntimePlayerEventMap[K]) => void;
export interface RuntimePlayerOptions {
    autoPlay?: boolean;
    loop?: boolean;
    playbackRate?: number;
    /** Allows generated autoplay even when the user prefers reduced motion. */
    autoplayWhenReducedMotion?: boolean;
}
export type SvgRootInput = SVGSVGElement | string;
export declare class RuntimePlayer {
    readonly root: SVGSVGElement;
    readonly bundle: RuntimeBundleV1;
    private _time;
    private _state;
    private _playbackRate;
    private _loop;
    private frameId?;
    private lastFrameTime?;
    private loopIteration;
    private readonly listeners;
    private readonly scene;
    private readonly initialAttributes;
    constructor(root: SVGSVGElement, bundle: RuntimeBundleV1, options?: RuntimePlayerOptions);
    get time(): number;
    get duration(): number;
    get state(): RuntimePlayerState;
    get playbackRate(): number;
    set playbackRate(value: number);
    get loop(): boolean;
    set loop(value: boolean);
    setPlaybackRate(value: number): this;
    setLoop(value: boolean): this;
    play(): this;
    pause(): this;
    stop(): this;
    seek(time: number): this;
    destroy(): void;
    on<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): () => void;
    off<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): void;
    private tick;
    private advance;
    private applyAt;
    private emitMarkers;
    private emit;
    private assertActive;
}
export declare function createPlayer(svgOrSelector: SvgRootInput, bundle: RuntimeBundleV1, options?: RuntimePlayerOptions): RuntimePlayer;
export declare function loadPlayer(svgOrSelector: SvgRootInput, bundleUrl: string | URL, options?: RuntimePlayerOptions): Promise<RuntimePlayer>;
export declare function validateRuntimeBundle(value: unknown): asserts value is RuntimeBundleV1;
//# sourceMappingURL=player.d.ts.map