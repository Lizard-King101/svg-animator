import { Group } from './elements/group.object';
import { Path } from './elements/path.object';
import { Shape } from './elements/shape.object';
import { AnyElement, SVG } from './svg.object';
import { combinedMatrixFor } from './element-bounds';
import { createScope, paperPathData } from './paper-geometry';
import { arcToCubics } from './arc-geometry';
import { ConstructionOutline } from './construction-network';
import { EllipseQueryTarget } from './ellipse-geometry';
import { applyMatrix } from './transform.object';

/** Snapshot visible, editable static outlines, including unmasked nested groups. */
export function constructionSources(svg: SVG, selectedIds?: ReadonlySet<string>, excludedIds = new Set<string>()): ConstructionOutline[] {
    const scope = createScope(), result: ConstructionOutline[] = [];
    const animated = new Set(svg.animation.tracks.map(track => track.targetId));
    const visit = (elements: AnyElement[], selected = !selectedIds) => elements.forEach(element => {
        if(!element.visible || element.locked || element.motion.pathId || animated.has(element.id) || excludedIds.has(element.id)) return;
        const included = selected || !!selectedIds?.has(element.id);
        if(element instanceof Group) { if(!element.clipElement) visit(element.elements, included); return; }
        if(!included || !(element instanceof Path || element instanceof Shape)) return;
        const matrix = combinedMatrixFor(svg.elements, element);
        if(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c) < 1e-10) return;
        let item: paper.PathItem;
        let ellipse: EllipseQueryTarget | undefined;
        if(element instanceof Path) {
            const rounded = element.contours.some(contour => contour.lines.some(line => line.points.some(point => point.cornerRadius > 0)));
            item = scope.PathItem.create(rounded ? element.raw : element.rawUnrounded);
        }
        else if(element.type === 'rectangle') item = new scope.Path.Rectangle({ rectangle: new scope.Rectangle(element.x, element.y, element.width, element.height), radius: element.settings.corner_radius ?? 0, insert: false });
        else {
            const path = new scope.Path({ insert: false });
            const rx = element.radiusX, ry = element.radiusY;
            if(rx <= 0 || ry <= 0) return;
            ellipse = { id: element.id, label: element.name, center: applyMatrix(matrix, element.centerX, element.centerY),
                axisX: { x: matrix.a * rx, y: matrix.b * rx }, axisY: { x: matrix.c * ry, y: matrix.d * ry } };
            const at = (t: number) => ({ id: 'ellipse', x: element.centerX + rx * Math.cos(t), y: element.centerY + ry * Math.sin(t) });
            path.moveTo([at(0).x, at(0).y]);
            // Small arcs keep native-ellipse approximation below construction join tolerance.
            for(let i = 0; i < 32; i++) for(const arc of arcToCubics(at(i * Math.PI / 16), at((i + 1) * Math.PI / 16), rx, ry, 0, false, true, () => 'ellipse')) {
                path.cubicCurveTo([arc.controlStart.x, arc.controlStart.y], [arc.controlEnd.x, arc.controlEnd.y], [arc.end.x, arc.end.y]);
            }
            path.closePath(); item = path;
        }
        item.transform(new scope.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f));
        result.push({ id: element.id, data: paperPathData(item), ellipse });
    });
    try { visit(svg.elements); return result; } finally { scope.remove(); }
}
