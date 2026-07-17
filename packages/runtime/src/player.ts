import {
    RUNTIME_BUNDLE_FORMAT_VERSION,
    RUNTIME_BUNDLE_KIND,
    RUNTIME_CAPABILITIES_V1,
    RuntimeBundleV1,
    RuntimeMarkerV1,
} from "./contracts";
import { evaluateRuntimeTrack } from "./evaluator";
import { RuntimePlayerError } from "./errors";
import { RuntimeScene } from "./scene";
import { resolveSvgRoot } from "./dom.internal";

export type RuntimePlayerState = "paused" | "playing" | "stopped" | "destroyed";
export type RuntimeMarkerDirection = "forward" | "reverse";

export interface RuntimePlayerEventMap {
    ready: { player: RuntimePlayer };
    play: { time: number };
    pause: { time: number };
    stop: { time: number };
    seek: { time: number; previousTime: number };
    complete: { time: number };
    loop: { time: number; iteration: number; direction: RuntimeMarkerDirection };
    marker: { marker: RuntimeMarkerV1; direction: RuntimeMarkerDirection };
    error: { error: RuntimePlayerError };
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

export class RuntimePlayer {
    private _time = 0;
    private _state: RuntimePlayerState = "paused";
    private _playbackRate: number;
    private _loop: boolean;
    private frameId?: number;
    private lastFrameTime?: number;
    private loopIteration = 0;
    private readonly listeners = new Map<RuntimePlayerEventType, Set<(event: never) => void>>();
    private readonly scene: RuntimeScene;
    private readonly initialAttributes: AttributeSnapshot[];

    constructor(readonly root: SVGSVGElement, readonly bundle: RuntimeBundleV1, options: RuntimePlayerOptions = {}) {
        validateRuntimeBundle(bundle);
        validateArtwork(root, bundle);
        this._playbackRate = finiteRate(options.playbackRate ?? 1);
        this._loop = options.loop ?? bundle.animation.loop;
        this.initialAttributes = snapshotAttributes(root);
        this.scene = new RuntimeScene(root, bundle.artwork.targets);
        this.applyAt(0);
        queueMicrotask(() => this.emit("ready", { player: this }));
        if(options.autoPlay && (options.autoplayWhenReducedMotion || !prefersReducedMotion())) queueMicrotask(() => this.play());
    }

    get time(): number { return this._time; }
    get duration(): number { return this.bundle.animation.duration; }
    get state(): RuntimePlayerState { return this._state; }
    get playbackRate(): number { return this._playbackRate; }
    set playbackRate(value: number) { this.assertActive(); this._playbackRate = finiteRate(value); }
    get loop(): boolean { return this._loop; }
    set loop(value: boolean) { this.assertActive(); this._loop = Boolean(value); }

    setPlaybackRate(value: number): this { this.playbackRate = value; return this; }
    setLoop(value: boolean): this { this.loop = value; return this; }

    play(): this {
        this.assertActive();
        if(this._state === "playing") return this;
        if(this.duration <= 0) { this.seek(0); this.emit("complete", { time: 0 }); return this; }
        if(this._playbackRate >= 0 && this._time >= this.duration) this.seek(0);
        if(this._playbackRate < 0 && this._time <= 0) this.seek(this.duration);
        this._state = "playing";
        this.lastFrameTime = undefined;
        this.emit("play", { time: this._time });
        this.frameId = requestAnimationFrame((time) => this.tick(time));
        return this;
    }

    pause(): this {
        this.assertActive();
        if(this.frameId != null) cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.lastFrameTime = undefined;
        if(this._state === "playing") {
            this._state = "paused";
            this.emit("pause", { time: this._time });
        }
        return this;
    }

    stop(): this {
        this.assertActive();
        if(this.frameId != null) cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.lastFrameTime = undefined;
        this._state = "stopped";
        this.applyAt(0);
        this.emit("stop", { time: this._time });
        return this;
    }

    seek(time: number): this {
        this.assertActive();
        const previousTime = this._time;
        const nextTime = clamp(Number.isFinite(time) ? time : 0, 0, this.duration);
        this.emitMarkers(previousTime, nextTime);
        this.applyAt(nextTime);
        this.emit("seek", { time: nextTime, previousTime });
        return this;
    }

    destroy(): void {
        if(this._state === "destroyed") return;
        if(this.frameId != null) cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.scene.clear();
        restoreAttributes(this.initialAttributes);
        this._state = "destroyed";
        this.emit("destroy", {});
        this.listeners.clear();
    }

    on<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): () => void {
        this.assertActive();
        let set = this.listeners.get(type);
        if(!set) { set = new Set(); this.listeners.set(type, set); }
        set.add(listener as (event: never) => void);
        return () => this.off(type, listener);
    }

    off<K extends RuntimePlayerEventType>(type: K, listener: RuntimePlayerListener<K>): void {
        this.listeners.get(type)?.delete(listener as (event: never) => void);
    }

    private tick(timestamp: number): void {
        if(this._state !== "playing") return;
        if(this.lastFrameTime == null) this.lastFrameTime = timestamp;
        const delta = Math.max(0, timestamp - this.lastFrameTime) / 1000 * this._playbackRate;
        this.lastFrameTime = timestamp;
        this.advance(delta);
        if(this._state === "playing") this.frameId = requestAnimationFrame((time) => this.tick(time));
    }

    private advance(delta: number): void {
        const previous = this._time;
        let next = previous + delta;
        if(this._loop && this.duration > 0) {
            let markerCursor = previous;
            while(next > this.duration || next < 0) {
                if(next > this.duration) {
                    this.emitMarkers(markerCursor, this.duration);
                    next -= this.duration;
                    this.loopIteration++;
                    this.emit("loop", { time: next, iteration: this.loopIteration, direction: "forward" });
                    markerCursor = 0;
                } else {
                    this.emitMarkers(markerCursor, 0);
                    next += this.duration;
                    this.loopIteration++;
                    this.emit("loop", { time: next, iteration: this.loopIteration, direction: "reverse" });
                    markerCursor = this.duration;
                }
            }
            this.emitMarkers(markerCursor, next);
        } else if((this._playbackRate > 0 && next >= this.duration) || (this._playbackRate < 0 && next <= 0)) {
            next = clamp(next, 0, this.duration);
            this.emitMarkers(previous, next);
            this.applyAt(next);
            this.pause();
            this.emit("complete", { time: next });
            return;
        } else {
            this.emitMarkers(previous, next);
        }
        this.applyAt(next);
    }

    private applyAt(time: number): void {
        this._time = time;
        const animation = this.bundle.animation;
        animation.tracks.forEach((track) => {
            const value = evaluateRuntimeTrack(track, time);
            if(value !== undefined) this.scene.write(animation.targets[track.target], animation.properties[track.property], value);
        });
        this.scene.render();
    }

    private emitMarkers(from: number, to: number): void {
        if(from === to) return;
        const direction: RuntimeMarkerDirection = to > from ? "forward" : "reverse";
        const markers = this.bundle.animation.markers.filter((marker) => direction === "forward"
            ? marker.time > from && marker.time <= to
            : marker.time < from && marker.time >= to);
        if(direction === "reverse") markers.reverse();
        markers.forEach((marker) => this.emit("marker", { marker, direction }));
    }

    private emit<K extends RuntimePlayerEventType>(type: K, event: RuntimePlayerEventMap[K]): void {
        this.listeners.get(type)?.forEach((listener) => {
            try { listener(event as never); }
            catch(error) {
                if(type !== "error") this.listeners.get("error")?.forEach((errorListener) => errorListener({ error: new RuntimePlayerError("invalid-bundle", `Runtime event listener for ${type} failed.`, error) } as never));
            }
        });
    }

    private assertActive(): void {
        if(this._state === "destroyed") throw new RuntimePlayerError("player-destroyed", "This RuntimePlayer has been destroyed.");
    }
}

export function createPlayer(svgOrSelector: SvgRootInput, bundle: RuntimeBundleV1, options?: RuntimePlayerOptions): RuntimePlayer {
    return new RuntimePlayer(resolveSvgRoot(svgOrSelector), bundle, options);
}

export async function loadPlayer(svgOrSelector: SvgRootInput, bundleUrl: string | URL, options?: RuntimePlayerOptions): Promise<RuntimePlayer> {
    let response: Response;
    try { response = await fetch(bundleUrl); }
    catch(error) { throw new RuntimePlayerError("fetch-failed", `Could not load runtime bundle from ${String(bundleUrl)}.`, error); }
    if(!response.ok) throw new RuntimePlayerError("fetch-failed", `Runtime bundle request failed with HTTP ${response.status}.`);
    let bundle: unknown;
    try { bundle = await response.json(); }
    catch(error) { throw new RuntimePlayerError("malformed-json", "The runtime bundle response was not valid JSON.", error); }
    validateRuntimeBundle(bundle);
    return createPlayer(svgOrSelector, bundle, options);
}

export function validateRuntimeBundle(value: unknown): asserts value is RuntimeBundleV1 {
    if(!value || typeof value !== "object") throw new RuntimePlayerError("invalid-bundle", "Runtime bundle must be an object.");
    const bundle = value as Partial<RuntimeBundleV1>;
    if(bundle.kind !== RUNTIME_BUNDLE_KIND) throw new RuntimePlayerError("invalid-bundle", `Expected bundle kind “${RUNTIME_BUNDLE_KIND}”.`);
    if(bundle.formatVersion !== RUNTIME_BUNDLE_FORMAT_VERSION) throw new RuntimePlayerError("unsupported-bundle-version", `Runtime v1 cannot play bundle format ${String(bundle.formatVersion)}.`);
    if(!Array.isArray(bundle.requiredCapabilities)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle requiredCapabilities must be an array.");
    const supported = new Set<string>(RUNTIME_CAPABILITIES_V1);
    const unsupported = bundle.requiredCapabilities.find((capability) => !supported.has(capability));
    if(unsupported) throw new RuntimePlayerError("unsupported-capability", `Runtime capability “${unsupported}” is not supported.`);
    if(!bundle.artwork || typeof bundle.artwork.signature !== "string" || !Array.isArray(bundle.artwork.targets)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle artwork is incomplete.");
    if(!bundle.animation || !Number.isFinite(bundle.animation.duration) || !Array.isArray(bundle.animation.tracks)
        || !Array.isArray(bundle.animation.targets) || !Array.isArray(bundle.animation.properties)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle animation is incomplete.");
    if(bundle.animation.duration < 0 || !Array.isArray(bundle.animation.markers) || !Array.isArray(bundle.animation.variables)) throw new RuntimePlayerError("invalid-bundle", "Runtime bundle timing metadata is invalid.");
    bundle.animation.tracks.forEach((track, index) => {
        if(!track || !Number.isInteger(track.target) || track.target < 0 || track.target >= bundle.animation!.targets.length
            || !Number.isInteger(track.property) || track.property < 0 || track.property >= bundle.animation!.properties.length
            || !Array.isArray(track.times) || !Array.isArray(track.values) || track.times.length === 0 || track.times.length !== track.values.length
            || track.times.some((time, timeIndex) => !Number.isFinite(time) || (timeIndex > 0 && time < track.times[timeIndex - 1]))) {
            throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has invalid indexes or keyframe arrays.`);
        }
        if(track.kind === "number" && (track.segmentModes.length !== track.times.length - 1 || track.temporalCoefficients.length !== Math.max(0, track.times.length - 1) * 8
            || track.values.some((item) => !Number.isFinite(item)))) throw new RuntimePlayerError("invalid-bundle", `Numeric runtime track ${index} is malformed.`);
        if(track.kind === "color" && (track.segmentModes.length !== track.times.length - 1 || track.interpolationSpaces.length !== track.times.length - 1
            || track.values.some((item) => !Number.isInteger(item)))) throw new RuntimePlayerError("invalid-bundle", `Color runtime track ${index} is malformed.`);
        if(track.kind !== "number" && track.kind !== "color" && track.kind !== "boolean" && track.kind !== "string") throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has an unknown kind.`);
    });
}

function validateArtwork(root: SVGSVGElement, bundle: RuntimeBundleV1): void {
    const actual = root.getAttribute("data-svg-animator-signature");
    if(actual !== bundle.artwork.signature) throw new RuntimePlayerError("artwork-signature-mismatch", actual
        ? `SVG artwork signature ${actual} does not match bundle ${bundle.artwork.signature}.`
        : "SVG artwork has no data-svg-animator-signature attribute.");
    const missing = bundle.artwork.targets.find((target) => !root.querySelector(`[id="${selectorValue(target.id)}"]`));
    if(missing) throw new RuntimePlayerError("artwork-signature-mismatch", `SVG artwork is missing runtime target “${missing.id}”.`);
}

interface AttributeSnapshot { node: Element; attributes: Array<[string, string]>; }
function snapshotAttributes(root: SVGSVGElement): AttributeSnapshot[] {
    return [root, ...root.querySelectorAll("*")].map((node) => ({ node, attributes: [...node.attributes].map((attribute) => [attribute.name, attribute.value]) }));
}
function restoreAttributes(snapshots: AttributeSnapshot[]): void {
    snapshots.forEach(({ node, attributes }) => {
        [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
        attributes.forEach(([name, value]) => node.setAttribute(name, value));
    });
}
function prefersReducedMotion(): boolean { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
function finiteRate(value: number): number { if(!Number.isFinite(value) || value === 0) throw new RangeError("playbackRate must be a finite non-zero number."); return value; }
function clamp(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, value)); }
function selectorValue(value: string): string { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
