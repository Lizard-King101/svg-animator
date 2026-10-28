import { experimentalGpu } from './experimental-gpu';
import { compilePolygonScene, PolygonSceneCompilation } from '../../src/app/editor/rendering/compiled-polygon-scene';
import { WebGpuPolygonRenderer } from '../../src/app/editor/rendering/webgpu-polygon-renderer';
import { sceneCases } from './scene-cases';

/** Owns the static scene preview UI; independent from timed animation workloads. */
export function initializeScenePreview(): { refresh: () => void } {
    const details = document.querySelector<HTMLDetailsElement>('#scene-preview')!;
    const select = details.querySelector<HTMLSelectElement>('select')!;
    const move = details.querySelector<HTMLInputElement>('input')!;
    const reference = details.querySelector<HTMLElement>('[data-scene-reference]')!;
    const canvas = details.querySelector<HTMLCanvasElement>('canvas')!;
    const status = details.querySelector<HTMLElement>('[role=status]')!;
    const cases = sceneCases();
    for(const [index, test] of cases.entries()) { const option = document.createElement('option'); option.value = String(index); option.textContent = test.name; select.append(option); }
    let renderer: WebGpuPolygonRenderer | undefined, starting = false, disposed = false, compiled: PolygonSceneCompilation;
    let index = 0, generation = 10000;
    function rebuild(): void {
        index = Number(select.value); move.value = '0';
        compiled = compilePolygonScene(cases[index].targets, ++generation); render();
    }
    function render(): void {
        const test = cases[index], offset = Number(move.value);
        // All markup is checked-in synthetic fixture data, never user/imported HTML.
        reference.innerHTML = test.svg.replace(/(<svg[^>]*>)/, `$1<g transform="translate(${offset} 0)">`).replace('</svg>', '</g></svg>');
        move.disabled = !compiled.eligible;
        canvas.hidden = !compiled.eligible || !renderer || !experimentalGpu.enabled;
        if(!compiled.eligible) { status.textContent = `SVG fallback: ${compiled.problems.map(problem => problem.reason).join(' ')}`; return; }
        if(!experimentalGpu.enabled) { status.textContent = 'SVG mode. Enable Experimental WebGPU to compare this scene.'; return; }
        if(!renderer) return;
        for(const target of test.targets) if(target.parentId === null) compiled.scene.updateTransform(target.id, { ...target.transform, translateX: target.transform.translateX + offset });
        const bounds = reference.getBoundingClientRect(), size = Math.max(1, Math.round(bounds.width * (devicePixelRatio || 1)));
        if(canvas.width !== size) canvas.width = canvas.height = size;
        try {
            renderer.render(compiled.scene.draws, { width: 128, height: 128 }, compiled.scene.clips);
            status.textContent = 'Eligible scene. Moving the scene updates transforms while retaining local geometry.';
        } catch(error) { canvas.hidden = true; status.textContent = `SVG fallback: ${String(error)}`; }
    }
    const initialize = () => {
        if(!details.open || disposed || !experimentalGpu.enabled) return;
        if(renderer) { render(); return; }
        if(starting) return;
        starting = true; const revision = experimentalGpu.revision;
        void WebGpuPolygonRenderer.create(canvas, reason => { renderer?.destroy(); renderer = undefined; canvas.hidden = true; status.textContent = reason; }).then(result => {
            starting = false;
            if('renderer' in result) {
                if(disposed || !experimentalGpu.enabled || revision !== experimentalGpu.revision) { result.renderer.destroy(); if(!disposed && experimentalGpu.enabled) initialize(); return; }
                renderer = result.renderer; render();
            } else status.textContent = result.reason;
        });
    };
    details.addEventListener('toggle', initialize);
    const unsubscribe = experimentalGpu.subscribe(enabled => {
        if(!enabled) { renderer?.destroy(); renderer = undefined; canvas.hidden = true; render(); } else initialize();
    });
    select.addEventListener('change', rebuild); move.addEventListener('input', render);
    window.addEventListener('resize', () => { if(details.open) render(); });
    window.addEventListener('pagehide', () => { disposed = true; unsubscribe(); renderer?.destroy(); });
    rebuild();
    return { refresh: () => { if(details.open) render(); } };
}
