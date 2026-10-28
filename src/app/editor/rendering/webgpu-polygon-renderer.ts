/// <reference types="@webgpu/types" />
import { PolygonDraw, PolygonFanBuffer, PolygonViewport, validatePolygonScene, validateFanVertices } from './polygon-scene';
import { ClipSchedule, ClipScheduleCache } from './clip-schedule';

export type WebGpuRendererResult = { renderer: WebGpuPolygonRenderer; adapter: GPUAdapterInfo }
    | { reason: string };
interface RetainedDraw { revision: number; vertex: GPUBuffer; bytes: number; count: number; uniform: GPUBuffer; group: GPUBindGroup; }
const code = `
struct Style { color: vec4f, viewport: vec2f, padding: vec2f, rowX: vec4f, rowY: vec4f }
@group(0) @binding(0) var<uniform> style: Style;
@group(1) @binding(0) var clipMask: texture_multisampled_2d<f32>;
@vertex fn winding(@location(0) point: vec2f) -> @builtin(position) vec4f {
    let local = vec3f(point, 1.0);
    let world = vec2f(dot(style.rowX.xyz, local), dot(style.rowY.xyz, local));
    return vec4f(world.x / style.viewport.x * 2.0 - 1.0, 1.0 - world.y / style.viewport.y * 2.0, 0.0, 1.0);
}
@vertex fn cover(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    return vec4f(positions[index], 0.0, 1.0);
}
@fragment fn paint() -> @location(0) vec4f { return vec4f(style.color.rgb * style.color.a, style.color.a); }
@fragment fn clippedPaint(@builtin(position) position: vec4f, @builtin(sample_index) sample: u32) -> @location(0) vec4f {
    let coverage = textureLoad(clipMask, vec2i(position.xy), sample).a;
    // Transparent output (not discard) still clears winding stencil outside the clip.
    return vec4f(style.color.rgb * style.color.a, style.color.a) * coverage;
}
`;

/** Experimental solid-polygon backend. Not selected by the editor until scene-feature
 * and raster parity gates pass. Stencil winding is modulo 256: pathological winding
 * magnitudes >=256 are outside this prototype's supported workload.
 */
export class WebGpuPolygonRenderer {
    private retained = new Map<string, RetainedDraw>();
    private readonly fan = new PolygonFanBuffer();
    private readonly uniformData = new Float32Array(16);
    private masks: { texture: GPUTexture; group: GPUBindGroup }[] = [];
    private readonly clipSchedules = new ClipScheduleCache();
    private dummy: GPUTexture;
    private dummyGroup: GPUBindGroup;
    private multisample?: GPUTexture;
    private stencil?: GPUTexture;
    private width = 0;
    private height = 0;
    private ended = false;
    private failure?: string;
    private constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, private device: GPUDevice,
        private context: GPUCanvasContext, private format: GPUTextureFormat,
        private layout: GPUBindGroupLayout, private maskLayout: GPUBindGroupLayout, private winding: GPURenderPipeline, private covers: GPURenderPipeline[],
        private onFailure: (reason: string) => void) {
        this.dummy = device.createTexture({ size: [1, 1], sampleCount: 4, format, usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT });
        this.dummyGroup = this.maskGroup(this.dummy);
        void device.lost.then(info => { if(!this.ended) this.fail(`WebGPU device lost: ${info.message || info.reason}`); });
        device.addEventListener('uncapturederror', event => this.fail(`WebGPU error: ${event.error.message}`));
    }

    static async create(canvas: HTMLCanvasElement | OffscreenCanvas, onFailure: (reason: string) => void,
        gpu: GPU | null | undefined = globalThis.navigator?.gpu): Promise<WebGpuRendererResult> {
        if(!gpu) return { reason: 'WebGPU is unavailable in this browser or context.' };
        let device: GPUDevice | undefined;
        let context: GPUCanvasContext | null = null;
        try {
            const adapter = await gpu.requestAdapter();
            if(!adapter) return { reason: 'No WebGPU adapter is available.' };
            device = await adapter.requestDevice();
            context = canvas.getContext('webgpu') as GPUCanvasContext | null;
            if(!context) { device.destroy(); return { reason: 'A WebGPU canvas context could not be created.' }; }
            const format = gpu.getPreferredCanvasFormat();
            context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
            device.pushErrorScope('validation');
            const module = device.createShaderModule({ code });
            const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });
            const maskLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { multisampled: true, sampleType: 'unfilterable-float' } }] });
            const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout, maskLayout] });
            const winding = await device.createRenderPipelineAsync({ layout: pipelineLayout,
                vertex: { module, entryPoint: 'winding', buffers: [{ arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] }] },
                fragment: { module, entryPoint: 'paint', targets: [{ format, writeMask: 0 }] },
                primitive: { topology: 'triangle-list', cullMode: 'none' }, multisample: { count: 4 },
                depthStencil: { format: 'stencil8', stencilFront: { compare: 'always', passOp: 'increment-wrap' }, stencilBack: { compare: 'always', passOp: 'decrement-wrap' } },
            });
            const face: GPUStencilFaceState = { compare: 'not-equal', passOp: 'zero' };
            const covers = await Promise.all([0, 1, 2, 3].map(index => device!.createRenderPipelineAsync({ layout: pipelineLayout,
                vertex: { module, entryPoint: 'cover' },
                fragment: { module, entryPoint: index >= 2 ? 'clippedPaint' : 'paint', targets: [{ format, blend: {
                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
                } }] },
                primitive: { topology: 'triangle-list' }, multisample: { count: 4 },
                depthStencil: { format: 'stencil8', stencilFront: face, stencilBack: face, stencilReadMask: index % 2 ? 1 : 255 },
            })));
            const error = await device.popErrorScope();
            if(error) throw new Error(error.message);
            return { renderer: new WebGpuPolygonRenderer(canvas, device, context, format, layout, maskLayout, winding, covers, onFailure), adapter: adapter.info };
        } catch(error) {
            context?.unconfigure(); device?.destroy();
            return { reason: `WebGPU initialization failed: ${error instanceof Error ? error.message : String(error)}` };
        }
    }

    /** Geometry stays resident until its revision changes. No GPU readback in playback. */
    render(draws: readonly PolygonDraw[], viewport: PolygonViewport, clips: readonly PolygonDraw[] = []): void { this.renderFrame(draws, viewport, clips); }

    /** Logical mask allocation, excluding color/stencil surfaces and driver overhead. */
    get clipMemory(): { textures: number; bytes: number } {
        return { textures: this.masks.length, bytes: this.width * this.height * 16 * this.masks.length };
    }

    private renderFrame(draws: readonly PolygonDraw[], viewport: PolygonViewport, clips: readonly PolygonDraw[], capture?: { buffer: GPUBuffer; bytesPerRow: number }): void {
        if(this.ended || this.failure) throw new Error(this.failure ?? 'Renderer has been destroyed.');
        validatePolygonScene(draws, viewport, clips);
        const width = this.canvas.width, height = this.canvas.height;
        if(!width || !height || Math.max(width, height) > this.device.limits.maxTextureDimension2D) throw new Error('Unsupported canvas dimensions.');
        const schedule = this.clipSchedules.get(draws, clips);
        if(width * height * 16 * schedule.slotCount > 256 * 1024 * 1024) throw new Error('Live clip textures exceed the 256 MiB renderer budget.');
        if(width !== this.width || height !== this.height) this.resize(width, height);
        const all = [...clips, ...draws], active = new Set(all.map(draw => draw.id));
        while(this.masks.length > schedule.slotCount) this.masks.pop()!.texture.destroy();
        while(this.masks.length < schedule.slotCount) {
            const texture = this.device.createTexture({ size: [width, height], sampleCount: 4, format: this.format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
            this.masks.push({ texture, group: this.maskGroup(texture) });
        }
        for(const [id, retained] of this.retained) if(!active.has(id)) { this.release(retained); this.retained.delete(id); }
        for(const draw of all) {
            let retained = this.retained.get(draw.id);
            if(!retained || retained.revision !== draw.revision) {
                const maxBytes = Math.min(64 * 1024 * 1024, this.device.limits.maxBufferSize);
                let data: Float32Array<ArrayBuffer>;
                if(draw.vertices) { validateFanVertices(draw.vertices, maxBytes); data = draw.vertices; }
                else { this.fan.write(draw.polygons, maxBytes); data = this.fan.data; }
                const bytes = Math.max(8, data.byteLength);
                if(!retained) {
                    const uniform = this.device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
                    retained = { revision: draw.revision, bytes, count: 0, uniform,
                        group: this.device.createBindGroup({ layout: this.layout, entries: [{ binding: 0, resource: { buffer: uniform } }] }),
                        vertex: this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }) };
                    this.retained.set(draw.id, retained);
                } else if(retained.bytes < bytes) {
                    retained.vertex.destroy(); retained.bytes = Math.min(this.device.limits.maxBufferSize, Math.max(bytes, retained.bytes * 2));
                    retained.vertex = this.device.createBuffer({ size: retained.bytes, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
                }
                if(data.length) this.device.queue.writeBuffer(retained.vertex, 0, data);
                retained.revision = draw.revision; retained.count = data.length / 2;
            }
            this.uniformData.set(draw.color); this.uniformData[4] = viewport.width; this.uniformData[5] = viewport.height;
            const m = draw.transform;
            this.uniformData.set([m?.a ?? 1, m?.c ?? 0, m?.e ?? 0, 0, m?.b ?? 0, m?.d ?? 1, m?.f ?? 0, 0], 8);
            this.device.queue.writeBuffer(retained.uniform, 0, this.uniformData);
        }
        const encoder = this.device.createCommandEncoder(), texture = this.context.getCurrentTexture();
        let painted = false;
        for(let index = 0; index < schedule.operations.length; index++) {
            const operation = schedule.operations[index];
            if(operation.kind === 'mask') {
                const clip = clips[operation.index];
                const clipPass = encoder.beginRenderPass({ colorAttachments: [{ view: this.masks[schedule.slots.get(clip.id)!].texture.createView(),
                    clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
                    depthStencilAttachment: { view: this.stencil!.createView(), stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' } });
                this.draw(clipPass, clip, schedule); clipPass.end();
            } else {
                const final = index === schedule.operations.length - 1;
                // Preserve every MSAA sample between paint batches; resolve only once.
                const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.multisample!.createView(),
                    resolveTarget: final ? texture.createView() : undefined, clearValue: [0, 0, 0, 0],
                    loadOp: painted ? 'load' : 'clear', storeOp: final ? 'discard' : 'store' }],
                    depthStencilAttachment: { view: this.stencil!.createView(), stencilClearValue: 0, stencilLoadOp: 'clear', stencilStoreOp: 'discard' } });
                for(let draw = operation.start; draw < operation.end; draw++) this.draw(pass, draws[draw], schedule);
                pass.end(); painted = true;
            }
        }
        if(capture) encoder.copyTextureToBuffer({ texture }, capture, [width, height]);
        this.device.queue.submit([encoder.finish()]);
    }

    /** Explicit diagnostic readback only. Copy is recorded before canvas presentation can clear it.
     * Returned bytes are premultiplied sRGB RGBA, independent of the swap-chain channel order.
     */
    async capture(draws: readonly PolygonDraw[], viewport: PolygonViewport, clips: readonly PolygonDraw[] = []): Promise<Uint8ClampedArray> {
        if(this.ended || this.failure) throw new Error(this.failure ?? 'Renderer has been destroyed.');
        const width = this.canvas.width, height = this.canvas.height, bytesPerRow = Math.ceil(width * 4 / 256) * 256;
        if(!width || !height || bytesPerRow * height > 64 * 1024 * 1024) throw new Error('Capture exceeds the readback budget.');
        const buffer = this.device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
            this.renderFrame(draws, viewport, clips, { buffer, bytesPerRow });
            await buffer.mapAsync(GPUMapMode.READ);
            if(this.failure) throw new Error(this.failure);
            const bytes = new Uint8Array(buffer.getMappedRange()), result = new Uint8ClampedArray(width * height * 4);
            const bgra = this.format.startsWith('bgra');
            for(let y = 0; y < height; y++) for(let x = 0; x < width; x++) {
                const source = y * bytesPerRow + x * 4, target = (y * width + x) * 4;
                result[target] = bytes[source + (bgra ? 2 : 0)]; result[target + 1] = bytes[source + 1];
                result[target + 2] = bytes[source + (bgra ? 0 : 2)]; result[target + 3] = bytes[source + 3];
            }
            return result;
        } finally { buffer.destroy(); }
    }

    async settled(): Promise<void> { await this.device.queue.onSubmittedWorkDone(); if(this.failure) throw new Error(this.failure); }
    destroy(): void {
        if(this.ended) return;
        this.ended = true; this.retained.forEach(value => this.release(value)); this.retained.clear();
        this.clearMasks(); this.dummy.destroy(); this.multisample?.destroy(); this.stencil?.destroy(); this.context.unconfigure(); this.device.destroy();
    }
    private draw(pass: GPURenderPassEncoder, draw: PolygonDraw, schedule: ClipSchedule): void {
        const retained = this.retained.get(draw.id)!;
        if(!retained.count || draw.color[3] === 0) return;
        pass.setStencilReference(0);
        pass.setBindGroup(0, retained.group);
        pass.setBindGroup(1, draw.clipId === undefined ? this.dummyGroup : this.masks[schedule.slots.get(draw.clipId)!].group);
        pass.setPipeline(this.winding); pass.setVertexBuffer(0, retained.vertex); pass.draw(retained.count);
        pass.setPipeline(this.covers[(draw.clipId === undefined ? 0 : 2) + (draw.fillRule === 'evenodd' ? 1 : 0)]); pass.draw(3);
    }
    private maskGroup(texture: GPUTexture): GPUBindGroup {
        return this.device.createBindGroup({ layout: this.maskLayout, entries: [{ binding: 0, resource: texture.createView() }] });
    }
    private clearMasks(): void { for(const mask of this.masks) mask.texture.destroy(); this.masks.length = 0; }
    private resize(width: number, height: number): void {
        this.clearMasks(); this.multisample?.destroy(); this.stencil?.destroy();
        const descriptor = { size: [width, height], sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT };
        this.multisample = this.device.createTexture({ ...descriptor, format: this.format });
        this.stencil = this.device.createTexture({ ...descriptor, format: 'stencil8' });
        this.width = width; this.height = height;
    }
    private release(value: RetainedDraw): void { value.vertex.destroy(); value.uniform.destroy(); }
    private fail(reason: string): void { if(this.ended || this.failure) return; this.failure = reason; this.onFailure(reason); }
}
