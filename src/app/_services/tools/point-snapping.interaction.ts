import { EditorService } from '../editor.service';
import { PathSnapExclusion, PointSnapSession, pathSnapGeometry } from '../../editor/objects/path-snapping';
import { Point } from '../../editor/objects/point.object';

/** Shared session lifecycle for pen placement and existing-anchor movement. */
export class PointSnappingInteraction {
    private session?: PointSnapSession;
    constructor(private editor: EditorService) {}
    get feedback() { return this.session?.feedback; }
    begin(exclusion?: PathSnapExclusion, lineOrigin?: { x: number; y: number }, curveEndpoint = false, commonTangents = true): void {
        const svg = this.editor.selectedSVG;
        const geometry = svg ? pathSnapGeometry(svg, exclusion) : undefined;
        this.session = svg && geometry ? new PointSnapSession(geometry.points, svg, geometry.segments, lineOrigin, geometry.ellipses, curveEndpoint, commonTangents) : undefined;
    }
    update(point: Point, bypass: boolean): Point {
        return this.session?.update(point, this.editor.selectedSVG?.zoom ?? 1, bypass || !this.editor.objectSnapping) ?? point;
    }
    clearFeedback(): void { this.session?.clear(); }
    clear(): void { this.session = undefined; }
}
