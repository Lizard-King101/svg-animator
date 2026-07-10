import type paperCore from 'paper/dist/paper-core';
import { EditorService } from 'src/app/_services/editor.service';
import { PathContour } from './elements/path.object';
import { Line } from './line.object';
import { Point } from './point.object';

declare const paper: typeof paperCore;

type ResolvablePathItem = paper.PathItem & {
    resolveCrossings(): paper.PathItem;
};

type DisposablePaperScope = paper.PaperScope & {
    remove(): void;
};

export function unionFilledPathContours(contours: PathContour[], editor: EditorService): PathContour[] | null {
    if(contours.length === 0 || typeof paper === 'undefined') {
        return null;
    }

    let scope: DisposablePaperScope | undefined;
    try {
        const activeScope = scope = createScope();
        const paths = contours.map((contour) => paperPathFromContour(activeScope, contour));
        let result: paper.PathItem = paths.shift()!;

        paths.forEach((path) => {
            const united = result.unite(path, { insert: false });
            result.remove();
            path.remove();
            result = united;
        });

        result = (result as ResolvablePathItem).resolveCrossings();
        result.reorient(true);
        return nativeContoursFromPaperItem(activeScope, result, editor);
    } catch {
        return null;
    } finally {
        scope?.remove();
    }
}

function createScope(): DisposablePaperScope {
    const scope = new paper.PaperScope() as DisposablePaperScope;
    scope.setup(new scope.Size(1, 1));
    scope.settings.insertItems = false;
    scope.activate();
    return scope;
}

function paperPathFromContour(scope: paper.PaperScope, contour: PathContour): paper.Path {
    const lines = contour.lines.filter((line) => line.points.length >= 2);
    const path = new scope.Path({ insert: false });
    if(lines.length === 0) {
        return path;
    }

    path.moveTo(paperPoint(scope, lines[0].points[0]));
    lines.forEach((line) => {
        const end = paperPoint(scope, line.points[1]);
        if(line.type === 'bezier' && line.controlStart && line.controlEnd) {
            path.cubicCurveTo(
                paperPoint(scope, line.controlStart),
                paperPoint(scope, line.controlEnd),
                end,
            );
        } else {
            path.lineTo(end);
        }
    });

    if(contour.closed) {
        path.closePath();
    }
    path.fillRule = 'nonzero';
    return path;
}

function nativeContoursFromPaperItem(scope: paper.PaperScope, item: paper.PathItem, editor: EditorService): PathContour[] {
    const paths = item instanceof scope.CompoundPath
        ? item.children.filter((child): child is paper.Path => child instanceof scope.Path)
        : (item instanceof scope.Path ? [item] : []);

    return paths
        .map((path) => nativeContourFromPaperPath(path, editor))
        .filter((contour): contour is PathContour => !!contour);
}

function nativeContourFromPaperPath(path: paper.Path, editor: EditorService): PathContour | null {
    if(path.segments.length < 2 || path.curves.length === 0) {
        return null;
    }

    const points = path.segments.map((segment) => new Point(segment.point.x, segment.point.y));
    const lines = path.curves.map((curve) => {
        const startIndex = curve.segment1.index;
        const endIndex = curve.segment2.index;
        const start = points[startIndex];
        const end = points[endIndex];
        const isBezier = !curve.isStraight();

        return new Line(editor, {
            type: isBezier ? 'bezier' : 'line',
            points: [start, end],
            controlStart: isBezier ? new Point(
                curve.segment1.point.x + curve.segment1.handleOut.x,
                curve.segment1.point.y + curve.segment1.handleOut.y,
            ) : undefined,
            controlEnd: isBezier ? new Point(
                curve.segment2.point.x + curve.segment2.handleIn.x,
                curve.segment2.point.y + curve.segment2.handleIn.y,
            ) : undefined,
        });
    });

    return {
        id: editor.ID,
        closed: path.closed,
        lines,
    };
}

function paperPoint(scope: paper.PaperScope, point: Point): paper.Point {
    return new scope.Point(point.x, point.y);
}
