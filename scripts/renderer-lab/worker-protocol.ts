import type { RendererSceneSnapshot } from '../../src/app/editor/rendering/animated-polygon-scene';
import type { FrameToken } from '../../src/app/editor/rendering/latest-frame-queue';
export interface FrameInput { time: number; width: number; height: number; capture?: boolean; settle?: boolean; }
export interface FrameResult {
    time: number; evaluationMs: number; geometryMs: number; submissionMs: number;
    pixels?: Uint8Array<ArrayBuffer>;
    clipMemory: { textures: number; bytes: number };
    /** End-of-benchmark queue drain only; never enabled for ordinary previews. */
    gpuDrainMs?: number;
}
export type WorkerRequest = { kind: 'init'; snapshot: RendererSceneSnapshot; canvas: OffscreenCanvas }
    | { kind: 'frame'; token: FrameToken; input: FrameInput };
export type WorkerResponse = { kind: 'ready'; generation: number; adapter: Record<string, unknown> }
    | { kind: 'frame'; token: FrameToken; result: FrameResult }
    | { kind: 'error'; generation: number; reason: string };
