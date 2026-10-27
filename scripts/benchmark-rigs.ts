import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRigPerformanceFixture } from '../src/app/editor/animation/rig-performance-fixture';
import { createDocumentEnvelope, migrateDocument } from '../src/app/editor/migrations/document-migrations';
import { SVG } from '../src/app/editor/objects/svg.object';
import { AnimationEvaluationPlan } from '../src/app/editor/animation/animation-evaluation-plan';
import { DocumentRigEvaluationPlan } from '../src/app/editor/rig-evaluation';
import { evaluateRigConstraints } from '../packages/runtime/src/rig/constraints';
import { deformBinding } from '../packages/runtime/src/rig/armature';
import { attachmentTransforms } from '../packages/runtime/src/rig/attachments';
import { RigEvaluationPlan } from '../packages/runtime/src/rig/evaluation-plan';

// Run through esbuild (see ANIMATION_PERFORMANCE.md). Never overwrites source projects.
let id = 0;
const editor = { get ID() { return `benchmark-${++id}`; } } as never;
const output = process.argv[2];
if(!output) throw new Error('Provide an output directory for synthetic fixture exports.');
await mkdir(output, { recursive: true });
const scenarios = [
    { name: 'one', rigs: 1 }, { name: 'three', rigs: 3 }, { name: 'ten', rigs: 10 },
    { name: 'ten-one-moving', rigs: 10, moving: 1, staticLayers: 500 },
    { name: 'ten-dense', rigs: 10, segments: 40 },
];
for(const scenario of scenarios) {
    const svg = createRigPerformanceFixture(editor, scenario);
    await writeFile(resolve(output, `${scenario.name}.svg-animator.json`), JSON.stringify(createDocumentEnvelope(svg.save())));
    benchmark(scenario.name, svg);
}
if(process.argv[3]) {
    const migrated = migrateDocument(JSON.parse(await readFile(process.argv[3], 'utf8')));
    if(migrated.status !== 'ok') throw new Error(migrated.warnings.join(' '));
    benchmark('local-project', SVG.fromSave(migrated.value.data, editor));
}

function benchmark(name: string, svg: SVG): void {
    const animation = new AnimationEvaluationPlan(svg.animation, svg.elements, svg.rigs);
    const compiled = svg.rigs.armatures.map(rig => new RigEvaluationPlan(rig));
    const timing = (evaluate: () => void) => {
        const samples: number[] = [];
        for(let i = 0; i < 900; i++) {
            animation.evaluateEach((i % 180) / 180 * svg.animation.duration, (track, value) => {
                if(track.rigChannel) track.rigChannel.bone[track.rigChannel.field] = Number(value);
            });
            const started = performance.now(); evaluate();
            if(i >= 300) samples.push(performance.now() - started);
        }
        samples.sort((a, b) => a - b);
        return { p50: samples[299], p95: samples[569], p99: samples[593], maximum: samples[599] };
    };
    const reference = timing(() => {
        for(const rig of svg.rigs.armatures) {
            const pose = evaluateRigConstraints({ ...rig, constraintsActive: true });
            pose.bindings.forEach(binding => deformBinding(pose, binding)); attachmentTransforms(pose);
        }
    });
    const optimized = timing(() => compiled.forEach((plan, i) => plan.evaluate(svg.rigs.armatures[i], true)));
    // Random-order sampling must produce exactly the same geometry at the same time.
    const documentPlan = new DocumentRigEvaluationPlan(svg);
    const at = (time: number) => {
        animation.evaluateEach(time, (track, value) => { if(track.rigChannel) track.rigChannel.bone[track.rigChannel.field] = Number(value); });
        documentPlan.apply(); return JSON.stringify(svg.save().elements);
    };
    const samples = Array.from({ length: 181 }, (_, i) => i / 180 * svg.animation.duration);
    const forward = samples.map(at);
    const mismatches = samples.map((time, i) => ({ time, expected: forward[i] })).reverse().filter(sample => at(sample.time) !== sample.expected).length;
    if(mismatches) throw new Error(`${name}: ${mismatches} backward/direct seek mismatches.`);
    console.log(JSON.stringify({ name, rigs: compiled.length, weightedPoints: svg.rigs.armatures.reduce((n, rig) => n + rig.bindings.reduce((m, binding) => m + binding.points.length, 0), 0), reference, optimized, seekMismatches: mismatches }));
}
