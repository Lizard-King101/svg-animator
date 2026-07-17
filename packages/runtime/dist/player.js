import { RUNTIME_BUNDLE_FORMAT_VERSION, RUNTIME_BUNDLE_KIND, RUNTIME_CAPABILITIES_V1, } from "./contracts";
import { evaluateRuntimeTrack } from "./evaluator";
import { RuntimePlayerError } from "./errors";
import { RuntimeScene } from "./scene";
import { resolveSvgRoot } from "./dom.internal";
export class RuntimePlayer {
    constructor(root, bundle, options = {}) {
        this.root = root;
        this.bundle = bundle;
        this._time = 0;
        this._state = "paused";
        this.loopIteration = 0;
        this.listeners = new Map();
        validateRuntimeBundle(bundle);
        validateArtwork(root, bundle);
        this._playbackRate = finiteRate(options.playbackRate ?? 1);
        this._loop = options.loop ?? bundle.animation.loop;
        this.initialAttributes = snapshotAttributes(root);
        this.scene = new RuntimeScene(root, bundle.artwork.targets);
        this.applyAt(0);
        queueMicrotask(() => this.emit("ready", { player: this }));
        if (options.autoPlay && (options.autoplayWhenReducedMotion || !prefersReducedMotion()))
            queueMicrotask(() => this.play());
    }
    get time() { return this._time; }
    get duration() { return this.bundle.animation.duration; }
    get state() { return this._state; }
    get playbackRate() { return this._playbackRate; }
    set playbackRate(value) { this.assertActive(); this._playbackRate = finiteRate(value); }
    get loop() { return this._loop; }
    set loop(value) { this.assertActive(); this._loop = Boolean(value); }
    setPlaybackRate(value) { this.playbackRate = value; return this; }
    setLoop(value) { this.loop = value; return this; }
    play() {
        this.assertActive();
        if (this._state === "playing")
            return this;
        if (this.duration <= 0) {
            this.seek(0);
            this.emit("complete", { time: 0 });
            return this;
        }
        if (this._playbackRate >= 0 && this._time >= this.duration)
            this.seek(0);
        if (this._playbackRate < 0 && this._time <= 0)
            this.seek(this.duration);
        this._state = "playing";
        this.lastFrameTime = undefined;
        this.emit("play", { time: this._time });
        this.frameId = requestAnimationFrame((time) => this.tick(time));
        return this;
    }
    pause() {
        this.assertActive();
        if (this.frameId != null)
            cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.lastFrameTime = undefined;
        if (this._state === "playing") {
            this._state = "paused";
            this.emit("pause", { time: this._time });
        }
        return this;
    }
    stop() {
        this.assertActive();
        if (this.frameId != null)
            cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.lastFrameTime = undefined;
        this._state = "stopped";
        this.applyAt(0);
        this.emit("stop", { time: this._time });
        return this;
    }
    seek(time) {
        this.assertActive();
        const previousTime = this._time;
        const nextTime = clamp(Number.isFinite(time) ? time : 0, 0, this.duration);
        this.emitMarkers(previousTime, nextTime);
        this.applyAt(nextTime);
        this.emit("seek", { time: nextTime, previousTime });
        return this;
    }
    destroy() {
        if (this._state === "destroyed")
            return;
        if (this.frameId != null)
            cancelAnimationFrame(this.frameId);
        this.frameId = undefined;
        this.scene.clear();
        restoreAttributes(this.initialAttributes);
        this._state = "destroyed";
        this.emit("destroy", {});
        this.listeners.clear();
    }
    on(type, listener) {
        this.assertActive();
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(listener);
        return () => this.off(type, listener);
    }
    off(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }
    tick(timestamp) {
        if (this._state !== "playing")
            return;
        if (this.lastFrameTime == null)
            this.lastFrameTime = timestamp;
        const delta = Math.max(0, timestamp - this.lastFrameTime) / 1000 * this._playbackRate;
        this.lastFrameTime = timestamp;
        this.advance(delta);
        if (this._state === "playing")
            this.frameId = requestAnimationFrame((time) => this.tick(time));
    }
    advance(delta) {
        const previous = this._time;
        let next = previous + delta;
        if (this._loop && this.duration > 0) {
            let markerCursor = previous;
            while (next > this.duration || next < 0) {
                if (next > this.duration) {
                    this.emitMarkers(markerCursor, this.duration);
                    next -= this.duration;
                    this.loopIteration++;
                    this.emit("loop", { time: next, iteration: this.loopIteration, direction: "forward" });
                    markerCursor = 0;
                }
                else {
                    this.emitMarkers(markerCursor, 0);
                    next += this.duration;
                    this.loopIteration++;
                    this.emit("loop", { time: next, iteration: this.loopIteration, direction: "reverse" });
                    markerCursor = this.duration;
                }
            }
            this.emitMarkers(markerCursor, next);
        }
        else if ((this._playbackRate > 0 && next >= this.duration) || (this._playbackRate < 0 && next <= 0)) {
            next = clamp(next, 0, this.duration);
            this.emitMarkers(previous, next);
            this.applyAt(next);
            this.pause();
            this.emit("complete", { time: next });
            return;
        }
        else {
            this.emitMarkers(previous, next);
        }
        this.applyAt(next);
    }
    applyAt(time) {
        this._time = time;
        const animation = this.bundle.animation;
        animation.tracks.forEach((track) => {
            const value = evaluateRuntimeTrack(track, time);
            if (value !== undefined)
                this.scene.write(animation.targets[track.target], animation.properties[track.property], value);
        });
        this.scene.render();
    }
    emitMarkers(from, to) {
        if (from === to)
            return;
        const direction = to > from ? "forward" : "reverse";
        const markers = this.bundle.animation.markers.filter((marker) => direction === "forward"
            ? marker.time > from && marker.time <= to
            : marker.time < from && marker.time >= to);
        if (direction === "reverse")
            markers.reverse();
        markers.forEach((marker) => this.emit("marker", { marker, direction }));
    }
    emit(type, event) {
        this.listeners.get(type)?.forEach((listener) => {
            try {
                listener(event);
            }
            catch (error) {
                if (type !== "error")
                    this.listeners.get("error")?.forEach((errorListener) => errorListener({ error: new RuntimePlayerError("invalid-bundle", `Runtime event listener for ${type} failed.`, error) }));
            }
        });
    }
    assertActive() {
        if (this._state === "destroyed")
            throw new RuntimePlayerError("player-destroyed", "This RuntimePlayer has been destroyed.");
    }
}
export function createPlayer(svgOrSelector, bundle, options) {
    return new RuntimePlayer(resolveSvgRoot(svgOrSelector), bundle, options);
}
export async function loadPlayer(svgOrSelector, bundleUrl, options) {
    let response;
    try {
        response = await fetch(bundleUrl);
    }
    catch (error) {
        throw new RuntimePlayerError("fetch-failed", `Could not load runtime bundle from ${String(bundleUrl)}.`, error);
    }
    if (!response.ok)
        throw new RuntimePlayerError("fetch-failed", `Runtime bundle request failed with HTTP ${response.status}.`);
    let bundle;
    try {
        bundle = await response.json();
    }
    catch (error) {
        throw new RuntimePlayerError("malformed-json", "The runtime bundle response was not valid JSON.", error);
    }
    validateRuntimeBundle(bundle);
    return createPlayer(svgOrSelector, bundle, options);
}
export function validateRuntimeBundle(value) {
    if (!value || typeof value !== "object")
        throw new RuntimePlayerError("invalid-bundle", "Runtime bundle must be an object.");
    const bundle = value;
    if (bundle.kind !== RUNTIME_BUNDLE_KIND)
        throw new RuntimePlayerError("invalid-bundle", `Expected bundle kind “${RUNTIME_BUNDLE_KIND}”.`);
    if (bundle.formatVersion !== RUNTIME_BUNDLE_FORMAT_VERSION)
        throw new RuntimePlayerError("unsupported-bundle-version", `Runtime v1 cannot play bundle format ${String(bundle.formatVersion)}.`);
    if (!Array.isArray(bundle.requiredCapabilities))
        throw new RuntimePlayerError("invalid-bundle", "Runtime bundle requiredCapabilities must be an array.");
    const supported = new Set(RUNTIME_CAPABILITIES_V1);
    const unsupported = bundle.requiredCapabilities.find((capability) => !supported.has(capability));
    if (unsupported)
        throw new RuntimePlayerError("unsupported-capability", `Runtime capability “${unsupported}” is not supported.`);
    if (!bundle.artwork || typeof bundle.artwork.signature !== "string" || !Array.isArray(bundle.artwork.targets))
        throw new RuntimePlayerError("invalid-bundle", "Runtime bundle artwork is incomplete.");
    if (!bundle.animation || !Number.isFinite(bundle.animation.duration) || !Array.isArray(bundle.animation.tracks)
        || !Array.isArray(bundle.animation.targets) || !Array.isArray(bundle.animation.properties))
        throw new RuntimePlayerError("invalid-bundle", "Runtime bundle animation is incomplete.");
    if (bundle.animation.duration < 0 || !Array.isArray(bundle.animation.markers) || !Array.isArray(bundle.animation.variables))
        throw new RuntimePlayerError("invalid-bundle", "Runtime bundle timing metadata is invalid.");
    bundle.animation.tracks.forEach((track, index) => {
        if (!track || !Number.isInteger(track.target) || track.target < 0 || track.target >= bundle.animation.targets.length
            || !Number.isInteger(track.property) || track.property < 0 || track.property >= bundle.animation.properties.length
            || !Array.isArray(track.times) || !Array.isArray(track.values) || track.times.length === 0 || track.times.length !== track.values.length
            || track.times.some((time, timeIndex) => !Number.isFinite(time) || (timeIndex > 0 && time < track.times[timeIndex - 1]))) {
            throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has invalid indexes or keyframe arrays.`);
        }
        if (track.kind === "number" && (track.segmentModes.length !== track.times.length - 1 || track.temporalCoefficients.length !== Math.max(0, track.times.length - 1) * 8
            || track.values.some((item) => !Number.isFinite(item))))
            throw new RuntimePlayerError("invalid-bundle", `Numeric runtime track ${index} is malformed.`);
        if (track.kind === "color" && (track.segmentModes.length !== track.times.length - 1 || track.interpolationSpaces.length !== track.times.length - 1
            || track.values.some((item) => !Number.isInteger(item))))
            throw new RuntimePlayerError("invalid-bundle", `Color runtime track ${index} is malformed.`);
        if (track.kind !== "number" && track.kind !== "color" && track.kind !== "boolean" && track.kind !== "string")
            throw new RuntimePlayerError("invalid-bundle", `Runtime track ${index} has an unknown kind.`);
    });
}
function validateArtwork(root, bundle) {
    const actual = root.getAttribute("data-svg-animator-signature");
    if (actual !== bundle.artwork.signature)
        throw new RuntimePlayerError("artwork-signature-mismatch", actual
            ? `SVG artwork signature ${actual} does not match bundle ${bundle.artwork.signature}.`
            : "SVG artwork has no data-svg-animator-signature attribute.");
    const missing = bundle.artwork.targets.find((target) => !root.querySelector(`[id="${selectorValue(target.id)}"]`));
    if (missing)
        throw new RuntimePlayerError("artwork-signature-mismatch", `SVG artwork is missing runtime target “${missing.id}”.`);
}
function snapshotAttributes(root) {
    return [root, ...root.querySelectorAll("*")].map((node) => ({ node, attributes: [...node.attributes].map((attribute) => [attribute.name, attribute.value]) }));
}
function restoreAttributes(snapshots) {
    snapshots.forEach(({ node, attributes }) => {
        [...node.attributes].forEach((attribute) => node.removeAttribute(attribute.name));
        attributes.forEach(([name, value]) => node.setAttribute(name, value));
    });
}
function prefersReducedMotion() { return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
function finiteRate(value) { if (!Number.isFinite(value) || value === 0)
    throw new RangeError("playbackRate must be a finite non-zero number."); return value; }
function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function selectorValue(value) { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
//# sourceMappingURL=player.js.map