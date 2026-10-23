import type paperCore from 'paper/dist/paper-core';
import { EditorService } from 'src/app/_services/editor.service';
import { PathContour } from './elements/path.object';

declare const paper: typeof paperCore;

type ResolvablePathItem = paper.PathItem & {
    resolveCrossings(): paper.PathItem;
};

import { createScope, DisposablePaperScope, nativeContoursFromPaperItem, paperPathFromContour } from './paper-geometry';

export function unionFilledPathContours(contours: PathContour[], editor: EditorService): PathContour[] | null {
    return unionFilledPathRegions(contours.map(contour => [contour]), editor, 'nonzero');
}

/** Union region groups while preserving holes within each even-odd region. */
export function unionFilledPathRegions(regions: PathContour[][], editor: EditorService, fillRule: 'evenodd' | 'nonzero' = 'evenodd'): PathContour[] | null {
    if(!regions.length || typeof paper === 'undefined') return null;

    let scope: DisposablePaperScope | undefined;
    try {
        const activeScope = scope = createScope();
        const paths = regions.map(contours => compoundPathFromContours(activeScope, contours, fillRule));
        let result: paper.PathItem = paths.shift()!;

        paths.forEach((path) => {
            const united = result.unite(path, { insert: false });
            result.remove();
            path.remove();
            result = united;
        });

        result = (result as ResolvablePathItem).resolveCrossings();
        result.reorient(fillRule === 'nonzero');
        return nativeContoursFromPaperItem(activeScope, result, editor);
    } catch {
        return null;
    } finally {
        scope?.remove();
    }
}

export function intersectFilledPathContours(subject: PathContour[], clip: PathContour[], editor: EditorService, clipFillRule: 'evenodd' | 'nonzero' = 'evenodd', subjectFillRule: 'evenodd' | 'nonzero' = 'nonzero'): PathContour[] | null {
    return booleanFilledPathContours(subject, clip, editor, "intersect", clipFillRule, subjectFillRule);
}

export function subtractFilledPathContours(subject: PathContour[], clip: PathContour[], editor: EditorService, clipFillRule: 'evenodd' | 'nonzero' = 'evenodd', subjectFillRule: 'evenodd' | 'nonzero' = 'nonzero'): PathContour[] | null {
    return booleanFilledPathContours(subject, clip, editor, "subtract", clipFillRule, subjectFillRule);
}

function booleanFilledPathContours(
    subjectContours: PathContour[],
    clipContours: PathContour[],
    editor: EditorService,
    operation: "intersect" | "subtract",
    clipFillRule: 'evenodd' | 'nonzero',
    subjectFillRule: 'evenodd' | 'nonzero',
): PathContour[] | null {
    if(subjectContours.length === 0 || clipContours.length === 0 || typeof paper === 'undefined') return null;
    let scope: DisposablePaperScope | undefined;
    try {
        const activeScope = scope = createScope();
        const subject = compoundPathFromContours(activeScope, subjectContours, subjectFillRule);
        const clip = compoundPathFromContours(activeScope, clipContours, clipFillRule);
        subject.fillColor = new activeScope.Color('black');
        clip.fillColor = new activeScope.Color('black');
        let result = operation === "intersect"
            ? subject.intersect(clip, { insert: false, trace: false })
            : subject.subtract(clip, { insert: false, trace: false });
        subject.remove();
        clip.remove();
        result.reorient(true);
        return nativeContoursFromPaperItem(activeScope, result, editor);
    } catch {
        return null;
    } finally {
        scope?.remove();
    }
}

function compoundPathFromContours(scope: paper.PaperScope, contours: PathContour[], fillRule: 'evenodd' | 'nonzero'): paper.PathItem {
    if(contours.length === 1) {
        const path = paperPathFromContour(scope, contours[0]);
        path.fillRule = fillRule;
        return path;
    }
    const compound = new scope.CompoundPath({ insert: false });
    contours.forEach((contour) => compound.addChild(paperPathFromContour(scope, contour)));
    compound.fillRule = fillRule;
    return compound;
}
