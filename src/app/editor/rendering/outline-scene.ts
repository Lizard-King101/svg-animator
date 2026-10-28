import type { RuntimeContourV1 } from '../../../../packages/runtime/src/contracts';
import { RigSceneEvaluation, RigSceneSetup } from './rig-scene-evaluation';
import { outlineProjectionProblem, visitOutlinePolygons, OutlineSection, OutlineStyle } from '../../../../packages/runtime/src/outline';
import { PolygonDraw, PolygonFanBuffer, validatePolygonScene } from './polygon-scene';

/** Internal, structured-cloneable outline-only snapshot. This is deliberately not a
 * general scene contract: callers must explicitly extract eligible solid outlines.
 * No model instances, framework state, DOM nodes or borrowed geometry cross this boundary.
 */
export interface OutlineSceneSnapshot extends RigSceneSetup {
    generation: number;
    paths: { id: string; contours: RuntimeContourV1[]; sections: OutlineSection[]; style: OutlineStyle;
        color: readonly [number, number, number, number] }[];
}

/** One owner per setup revision; safe for arbitrary continuous-time seeks. */
export class OutlineScene {
    private readonly snapshot: OutlineSceneSnapshot;
    readonly clips: PolygonDraw[] = [];
    private readonly evaluation;
    private readonly paths;
    private revision = 0;
    private readonly draws: PolygonDraw[];
    constructor(snapshot: OutlineSceneSnapshot) {
        if(!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1) throw new Error('Invalid scene generation.');
        this.snapshot = structuredClone(snapshot);
        this.evaluation = new RigSceneEvaluation(this.snapshot);
        this.paths = this.snapshot.paths.map(path => {
            if(path.style.alignment && path.style.alignment !== 'center') throw new Error('Outline scene requires centered strokes.');
            const problem = outlineProjectionProblem(path.contours, path.sections, path.style);
            if(problem) throw new Error(problem);
            const points = this.evaluation.bindPath(path.id, path.contours);
            const draw: Extract<PolygonDraw, { vertices: Float32Array }> = {
                id: `${snapshot.generation}:${path.id}`, revision: -1, color: path.color, vertices: new Float32Array(0),
            };
            return { path, points, buffer: new PolygonFanBuffer(), draw };
        });
        this.draws = this.paths.map(path => path.draw);
        validatePolygonScene(this.draws, { width: 1, height: 1 });
    }
    evaluate(time: number): void {
        this.evaluation.evaluate(time);
        // All rigs must succeed before any drawable points are published.
        for(const path of this.paths) for(const { point, value } of path.points) { point.x = value.x; point.y = value.y; }
        this.revision++;
    }
    /** Borrowed until next evaluation; keep storage in its producing thread. */
    packedGeometry(): PolygonDraw[] {
        for(const entry of this.paths) {
            if(entry.draw.revision === this.revision) continue;
            entry.buffer.reset();
            const result = visitOutlinePolygons(entry.path.contours, entry.path.sections, entry.path.style, points => entry.buffer.append(points));
            if(result.problem) throw new Error(result.problem);
            entry.draw.vertices = entry.buffer.data; entry.draw.revision = this.revision;
        }
        return this.draws;
    }
}
