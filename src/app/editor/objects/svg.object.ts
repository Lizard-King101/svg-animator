import { EditorService } from "src/app/_services/editor.service";
import { Group, GroupSave } from "./elements/group.object";
import { Path, PathSave } from "./elements/path.object";
import { Shape, ShapeSave } from "./elements/shape.object";
import { TextElement, TextSave } from "./elements/text.object";
import { Point } from "./point.object";
import { AnimationDocument, AnimationSave, cloneAnimation, createDefaultAnimation, restoreAnimation } from "./animation.object";

export type ElementSave = PathSave | ShapeSave | GroupSave | TextSave;
export type AnyElement = Path | Shape | Group | TextElement;

export interface CanvasGuide {
    id: string;
    axis: "x" | "y";
    value: number;
}

/** Sanitized, inert source retained for SVG nodes outside the native model. */
export interface ImportedSourceNode {
    id: string;
    parentId: string | null;
    tagName: string;
    markup: string;
}

export interface SVGSave {
    id: string;
    name: string;
    elements: ElementSave[];
    animation?: AnimationSave;
    guides?: CanvasGuide[];
    guidesLocked?: boolean;
    importedSourceNodes?: ImportedSourceNode[];
    width: number;
    height: number;
}

export class SVG {
    id: string;
    name?: string;
    elements: AnyElement[] = [];
    tempElements: Array<Path | Shape> = [];
    animation: AnimationDocument;
    guides: CanvasGuide[] = [];
    guidesLocked = false;
    importedSourceNodes: ImportedSourceNode[] = [];
    width: number;
    height: number;
    zoom: number;
    pos: Point;

    private _past: SharedHistorySnapshot[] = [];
    private _future: SharedHistorySnapshot[] = [];
    private readonly _maxHistory = 50;
    private readonly _maxHistoryBytes = 64 * 1024 * 1024;

    get canUndo() { return this._past.length > 1; }
    get canRedo() { return this._future.length > 0; }

    constructor(private editor: EditorService, options: SVGOptions) {
        this.id = this.editor.ID;
        this.name = options.name ?? ('new_svg_' + this.id);
        this.width = options.width;
        this.height = options.height;
        this.pos = options.pos;
        this.zoom = options.zoom ?? 1;
        this.animation = createDefaultAnimation();
        this._past.push(sharedSnapshot(this.save()));
    }

    static fromSave(save: SVGSave, editor: EditorService, vpWidth = 800, vpHeight = 600): SVG {
        const svg = new SVG(editor, {
            width: save.width,
            height: save.height,
            name: save.name,
            pos: new Point(
                (vpWidth / 2) - (save.width / 2),
                (vpHeight / 2) - (save.height / 2)
            ),
        });
        (svg as any).id = save.id;
        svg.elements = SVG._restoreElements(save.elements, editor);
        svg.animation = restoreAnimation(save.animation);
        svg.guides = Array.isArray(save.guides)
            ? save.guides.map(restoreGuide).filter((guide): guide is CanvasGuide => !!guide)
            : [];
        svg.guidesLocked = !!save.guidesLocked;
        svg.importedSourceNodes = restoreImportedSourceNodes(save.importedSourceNodes);
        (svg as any)._past = [sharedSnapshot(svg.save())];
        (svg as any)._future = [];
        return svg;
    }

    // ── Serialization ──────────────────────────────────────────────

    save(): SVGSave {
        return {
            id: this.id,
            name: this.name ?? '',
            elements: this.elements.map((e) => e.save()) as ElementSave[],
            animation: cloneAnimation(this.animation),
            guides: this.guides.map((guide) => ({
                id: guide.id,
                axis: guide.axis,
                value: round(guide.value),
            })),
            guidesLocked: this.guidesLocked,
            importedSourceNodes: this.importedSourceNodes.map((node) => ({ ...node })),
            width: this.width,
            height: this.height,
        };
    }

    private static _restoreElements(elements: ElementSave[], editor: EditorService): AnyElement[] {
        const result: AnyElement[] = [];
        for (const es of elements) {
            if (es.type === 'path')  result.push(Path.fromSave(es, editor));
            else if (es.type === 'shape') result.push(Shape.fromSave(es, editor));
            else if (es.type === 'text')  result.push(TextElement.fromSave(es, editor));
            else if (es.type === 'group') result.push(Group.fromSave(es, editor));
        }
        return result;
    }

    private restore(snap: SVGSave) {
        this.id = snap.id;
        this.name = snap.name;
        this.width = snap.width;
        this.height = snap.height;
        this.elements = SVG._restoreElements(snap.elements, this.editor);
        this.animation = restoreAnimation(snap.animation);
        this.guides = Array.isArray(snap.guides)
            ? snap.guides.map(restoreGuide).filter((guide): guide is CanvasGuide => !!guide)
            : [];
        this.guidesLocked = !!snap.guidesLocked;
        this.importedSourceNodes = restoreImportedSourceNodes(snap.importedSourceNodes);
    }

    // ── History ────────────────────────────────────────────────────

    snapshot(save = this.save()) {
        const last = this._past[this._past.length - 1];
        const snap = sharedSnapshot(save, last);
        if(last && sameSnapshot(last, snap)) return;
        this._past.push(snap);
        while(this._past.length > this._maxHistory || uniqueSectionBytes(this._past) > this._maxHistoryBytes) this._past.shift();
        this._future = [];
    }

    undo() {
        if (!this.canUndo) return;
        this._future.push(sharedSnapshot(this.save(), this._past[this._past.length - 1]));
        this._past.pop();
        this.restore(snapshotSave(this._past[this._past.length - 1]));
    }

    redo() {
        if (!this.canRedo) return;
        const snap = this._future.pop()!;
        this._past.push(sharedSnapshot(this.save(), this._past[this._past.length - 1]));
        this.restore(snapshotSave(snap));
    }
}

interface SharedSection<T> { value: T; serialized: string; bytes: number; }
interface SharedHistorySnapshot {
    identity: SharedSection<Pick<SVGSave, "id" | "name" | "width" | "height">>;
    artwork: SharedSection<Pick<SVGSave, "elements" | "importedSourceNodes">>;
    animation: SharedSection<SVGSave["animation"]>;
    guides: SharedSection<Pick<SVGSave, "guides" | "guidesLocked">>;
}

function sharedSnapshot(save: SVGSave, previous?: SharedHistorySnapshot): SharedHistorySnapshot {
    return {
        identity: shareSection({ id: save.id, name: save.name, width: save.width, height: save.height }, previous?.identity),
        artwork: shareSection({ elements: save.elements, importedSourceNodes: save.importedSourceNodes }, previous?.artwork),
        animation: shareSection(save.animation, previous?.animation),
        guides: shareSection({ guides: save.guides, guidesLocked: save.guidesLocked }, previous?.guides),
    };
}

function shareSection<T>(value: T, previous?: SharedSection<T>): SharedSection<T> {
    const serialized = JSON.stringify(value);
    if(previous?.serialized === serialized) return previous;
    return { value, serialized, bytes: new Blob([serialized]).size };
}

function sameSnapshot(a: SharedHistorySnapshot, b: SharedHistorySnapshot): boolean {
    return a.identity === b.identity && a.artwork === b.artwork && a.animation === b.animation && a.guides === b.guides;
}

function snapshotSave(snapshot: SharedHistorySnapshot): SVGSave {
    return { ...snapshot.identity.value, ...snapshot.artwork.value, animation: snapshot.animation.value, ...snapshot.guides.value };
}

function uniqueSectionBytes(snapshots: readonly SharedHistorySnapshot[]): number {
    const sections = new Set<SharedSection<unknown>>();
    snapshots.forEach((snapshot) => {
        sections.add(snapshot.identity as SharedSection<unknown>);
        sections.add(snapshot.artwork as SharedSection<unknown>);
        sections.add(snapshot.animation as SharedSection<unknown>);
        sections.add(snapshot.guides as SharedSection<unknown>);
    });
    let bytes = 0;
    sections.forEach((section) => bytes += section.bytes);
    return bytes;
}

function restoreImportedSourceNodes(input: unknown): ImportedSourceNode[] {
    if(!Array.isArray(input)) return [];
    return input.filter((node): node is ImportedSourceNode => {
        return !!node
            && typeof node.id === "string"
            && (typeof node.parentId === "string" || node.parentId === null)
            && typeof node.tagName === "string"
            && typeof node.markup === "string";
    }).map((node) => ({ ...node }));
}

function restoreGuide(save: Partial<CanvasGuide>): CanvasGuide | undefined {
    if(!save || (save.axis !== "x" && save.axis !== "y")) {
        return undefined;
    }

    const numeric = typeof save.value === "number" ? save.value : Number(save.value);
    if(!Number.isFinite(numeric)) {
        return undefined;
    }

    return {
        id: typeof save.id === "string" ? save.id : Math.random().toString(36).substr(2, 9),
        axis: save.axis,
        value: numeric,
    };
}

function round(value: number): number {
    return Math.round(value * 10000) / 10000;
}

interface SVGOptions {
    width: number;
    height: number;
    pos: Point;
    zoom?: number;
    name?: string;
}
