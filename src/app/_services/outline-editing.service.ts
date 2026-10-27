import { Injectable, OnDestroy } from '@angular/core';
import type { OutlinePosition, OutlineSection } from '../../../packages/runtime/src/outline';
import { outlineSectionsProblem } from '../../../packages/runtime/src/outline';
import { pathOutlineContours, pathOutlineProblem } from '../editor/path-outline';
import { Path, pathContourSegments } from '../editor/objects/elements/path.object';
import { Line } from '../editor/objects/line.object';
import { findElementChain } from '../editor/objects/element-bounds';
import { editOutlineTaper, fullOutlineSections, moveOutlineEndpoint, setOutlineSegmentsVisible } from '../editor/outline-editing';
import { resolvedOutlineSections, setOutlinePreview } from '../editor/outline-preview';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { EditorService } from './editor.service';

/** Owns outline scope, selection and nonpersistent drafts. Geometry and rig data never change here. */
@Injectable()
export class OutlineEditingService implements OnDestroy {
    path?: Path;
    selectedIds: string[] = [];
    selectedSegmentIds: string[] = [];
    picking: 'sections' | 'segments' = 'sections';
    feedback = '';
    private initialSections: OutlineSection[] = [];
    private scope?: { svg: unknown; tool: unknown };
    private draft?: { revision: number; source: string; original: OutlineSection[]; sections: OutlineSection[] };
    private history = this.mutations.historyRestored?.subscribe(() => this.end());
    constructor(public editor: EditorService, private animation: AnimationPlaybackService, private mutations: DocumentMutationService) {}
    get active(): boolean { return !!this.path; }
    get previewing(): boolean { return !!this.draft; }
    get sections(): OutlineSection[] { return this.path ? resolvedOutlineSections(this.path) ?? this.initialSections : []; }
    get selected(): OutlineSection[] { return this.sections.filter(section => this.selectedIds.includes(section.id)); }
    problem(path: Path): string { return pathOutlineProblem(path) ?? ''; }
    canEdit(path: Path): boolean {
        const svg = this.editor.selectedSVG, chain = svg && findElementChain(svg.elements, path);
        return this.animation.mode === 'edit' && !this.animation.playing && !!chain?.length && chain.every(element => element.visible && !element.locked) && !this.problem(path);
    }
    begin(path: Path): void {
        if(!this.canEdit(path)) return;
        if(this.path === path) return;
        this.end(); this.path = path; this.feedback = '';
        this.initialSections = fullOutlineSections(path, () => this.editor.ID);
        this.scope = { svg: this.editor.selectedSVG, tool: this.editor.activeTool };
        this.selectedIds = this.sections.length ? [this.sections[0].id] : [];
        this.selectedSegmentIds = [...this.editor.selectedPathLines, ...(this.editor.selectedPathLine ? [this.editor.selectedPathLine] : [])].map(line => line.id);
    }
    end(): void { this.cancel(); this.path = undefined; this.scope = undefined; this.selectedIds = []; this.selectedSegmentIds = []; }
    validate(): void {
        const path = this.path;
        if(path && (!this.canEdit(path) || this.editor.selectedElement !== path || this.scope?.svg !== this.editor.selectedSVG || this.scope?.tool !== this.editor.activeTool)) { this.end(); return; }
        if(this.draft && (this.draft.revision !== this.mutations.revision || this.draft.source !== JSON.stringify(path?.save()))) this.cancel();
        if(path) this.selectedIds = this.selectedIds.filter(id => this.sections.some(section => section.id === id));
    }
    select(id: string, toggle = false): void {
        this.cancel();
        this.selectedIds = toggle ? this.selectedIds.includes(id) ? this.selectedIds.filter(item => item !== id) : [...this.selectedIds, id] : [id];
    }
    selectSegment(id: string, toggle = false): void {
        this.cancel(); this.selectedSegmentIds = toggle ? this.selectedSegmentIds.includes(id) ? this.selectedSegmentIds.filter(item => item !== id) : [...this.selectedSegmentIds, id] : [id];
    }
    selectAll(): void { this.cancel(); this.selectedIds = this.sections.map(section => section.id); }
    /** The outline session owns canvas shortcuts; hidden source handles must never receive them. */
    handleKey(event: KeyboardEvent): boolean {
        if(!this.active) return false;
        const command = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
        if(command && ['d', 'z', 'y'].includes(key)) return false;
        if(command && key === 'a') {
            if(this.picking === 'segments') {
                this.cancel(); this.selectedSegmentIds = this.path!.contours.flatMap(pathContourSegments).map(line => line.id);
            } else this.selectAll();
            event.preventDefault();
        } else if(key === 'delete' || key === 'backspace') {
            if(this.picking === 'segments') this.setSelectedSegmentsVisible(false); else this.hideSelected();
            event.preventDefault();
        } else if(key.startsWith('arrow') || key === 'i' || key === 'c' || key === 'enter' || key === ' ') {
            // Endpoint controls handle their own arrows before the event reaches the page.
            event.preventDefault();
        }
        return true;
    }
    startPreview(): boolean {
        this.validate(); if(!this.path) return false;
        if(!this.draft) this.draft = { revision: this.mutations.revision, source: JSON.stringify(this.path.save()), original: structuredClone(this.sections), sections: structuredClone(this.sections) };
        return true;
    }
    resetPreview(): void {
        this.validate(); if(!this.draft) return;
        this.draft.sections = structuredClone(this.draft.original); this.publish();
    }
    previewEndpoint(id: string, end: 'start' | 'end', position: OutlinePosition): void {
        if(!this.startPreview()) return;
        const section = this.draft!.original.find(section => section.id === id), contour = this.path!.contours.find(contour => contour.id === section?.contourId);
        if(!contour) return;
        this.draft!.sections = moveOutlineEndpoint(contour, this.draft!.sections, id, end, position); this.publish();
    }
    previewTaper(end: 'start' | 'end', field: 'length' | 'tipWidth', percent: number): void {
        if(!Number.isFinite(percent) || !this.startPreview()) return;
        for(const section of this.draft!.sections) if(this.selectedIds.includes(section.id)) editOutlineTaper(section, end, field, percent / 100);
        this.publish();
    }
    pointed(end: 'start' | 'end'): void { this.previewTaper(end, 'length', 20); this.previewTaper(end, 'tipWidth', 0); this.commit(); }
    private publish(): void { if(this.path && this.draft) setOutlinePreview(this.path, this.draft.sections); }
    commit(): void {
        this.validate(); const path = this.path, draft = this.draft;
        if(!path || !draft) return;
        this.cancel();
        if(JSON.stringify(draft.sections) !== JSON.stringify(draft.original)) this.applySections(path, draft.sections);
    }
    cancel(): void { if(this.path) setOutlinePreview(this.path, undefined); this.draft = undefined; }
    restore(): void {
        this.cancel(); const path = this.path; if(!path || path.outlineSections === undefined) return;
        this.mutations.mutate(() => path.outlineSections = undefined);
        this.selectedIds = this.initialSections.map(section => section.id);
    }
    setSegmentsVisible(path: Path, lines: Line[], visible: boolean): void {
        this.begin(path); if(this.path !== path) return;
        this.selectedSegmentIds = lines.map(line => line.id); this.setSelectedSegmentsVisible(visible);
    }
    setSelectedSegmentsVisible(visible: boolean): void {
        this.cancel(); const path = this.path; if(!path || !this.selectedSegmentIds.length) return;
        const original = this.sections;
        const sections = setOutlineSegmentsVisible(path, original, new Set(this.selectedSegmentIds), visible, () => this.editor.ID);
        if(JSON.stringify(sections) === JSON.stringify(original)) return;
        if(!this.applySections(path, sections)) return;
        this.selectedIds = sections.filter(section => this.selectedIds.includes(section.id)).map(section => section.id);
        if(!this.selectedIds.length && sections.length) this.selectedIds = [sections[0].id];
    }
    hideSelected(): void {
        this.cancel(); const path = this.path; if(!path || !this.selectedIds.length) return;
        const sections = this.sections.filter(section => !this.selectedIds.includes(section.id));
        if(this.applySections(path, sections)) this.selectedIds = [];
    }
    private applySections(path: Path, sections: OutlineSection[]): boolean {
        this.feedback = outlineSectionsProblem(pathOutlineContours(path), sections) ?? pathOutlineProblem(path, sections) ?? '';
        if(this.feedback) return false;
        this.mutations.mutate(() => path.outlineSections = structuredClone(sections)); return true;
    }
    ngOnDestroy(): void { this.end(); this.history?.unsubscribe(); }
}
