import { RowPointerDrag, RowDropPosition, rowDropPosition } from '../../editor/row-pointer-drag';
import { DocumentMutationService } from '../../_services/document-mutation.service';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faGripVertical, faTrash } from '@fortawesome/free-solid-svg-icons';
import { contextMenuSections, EditorContextMenuItem } from '../../_services/editor.service';
import { AfterViewChecked, Component, DoCheck, ElementRef, HostListener, OnDestroy } from '@angular/core';
import { NgFor, NgIf } from '@angular/common';
import { RigEditingService } from '../../_services/rig-editing.service';
import { RigBindingSessionService } from '../../_services/rig-binding-session.service';

@Component({
    selector: 'app-rig-layers', standalone: true, imports: [NgFor, NgIf, FaIconComponent],
    template: `<div class="rig-heading"><span>Bones</span><button class="btn btn-sm btn-secondary" (click)="rig.create()">New armature</button></div>
      <div role="tree" aria-label="Bones">
        <div *ngFor="let row of rows; trackBy: track" role="treeitem" [attr.aria-level]="row.depth + 1" [attr.aria-expanded]="row.children ? !collapsed.has(row.id) : null" [attr.aria-selected]="selected(row)" [attr.aria-label]="row.name" [attr.data-bone-row]="row.id" tabindex="0"
          class="bone-row" [class.selected]="selected(row)" [class.picked]="session.pending?.bones?.includes(row.boneId) && session.pending?.rigId === row.rigId" [style.padding-left.px]="12 + row.depth * 16"
          (click)="choose(row)" (keydown)="key($event, row)" (dblclick)="beginRename(row)" (contextmenu)="menu($event, row)" (pointermove)="moveDrag($event)" (pointerup)="finishDrag($event)" (pointercancel)="cancelDrag()" (lostpointercapture)="cancelDrag()" [class.dragging]="drag.pending?.started && drag.pending?.value?.id === row.id" [class.drop-before]="drop?.row?.id === row.id && drop?.position === 'before'" [class.drop-after]="drop?.row?.id === row.id && drop?.position === 'after'" [class.drop-inside]="drop?.row?.id === row.id && drop?.position === 'inside'">
          <button class="drag-handle row-control" [attr.aria-label]="'Drag ' + row.name" title="Drag bone layer" (pointerdown)="beginDrag($event,row)" (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()"><fa-icon [icon]="gripIcon" /></button>
          <button *ngIf="row.children" class="expander" [attr.aria-label]="(collapsed.has(row.id) ? 'Expand ' : 'Collapse ') + row.name" (click)="$event.stopPropagation(); toggle(row.id)">{{collapsed.has(row.id) ? '▸' : '▾'}}</button>
          <span *ngIf="!row.children" class="expander"></span><span class="glyph">{{row.point ? '⊕' : '◇'}}</span><span *ngIf="renaming?.id !== row.id" class="name">{{row.name}}</span>
          <input *ngIf="renaming?.id === row.id" class="rename" [attr.aria-label]="'Rename ' + row.name" [value]="row.name" maxlength="60" (click)="$event.stopPropagation()" (dblclick)="$event.stopPropagation()" (keydown)="renameKey($event)" (blur)="finishRename($any($event.target).value)" />
          <button class="row-menu row-control" [attr.aria-label]="'Actions for ' + row.name" title="Bone actions" (click)="menu($event, row)" (dblclick)="$event.stopPropagation()">⋯</button>
          <button class="row-control trash" [attr.aria-label]="'Delete ' + row.name" [title]="row.depth === 0 ? 'Delete armature' : 'Delete bone'" (click)="$event.stopPropagation(); remove(row)" (dblclick)="$event.stopPropagation()"><fa-icon [icon]="trashIcon" /></button>
        </div>
      </div>`,
    styles: `:host {display:block; border-bottom:1px solid var(--border);} .rig-heading {display:flex; justify-content:space-between; align-items:center; padding:8px 12px; font-size:11px; color:var(--text-secondary);} .bone-row {display:flex; gap:6px; align-items:center; min-height:28px; cursor:pointer; font-size:12px; color:var(--text-secondary);} .bone-row:hover {background:var(--bg-hover);} .bone-row.selected {color:var(--accent); background:var(--accent-dim);} .bone-row.picked {box-shadow:inset 3px 0 var(--accent);} .bone-row:focus-visible {outline:1px solid var(--accent); outline-offset:-1px;} .expander {width:14px; padding:0; border:0; background:transparent; color:inherit;} .glyph {font-size:18px;} .row-control {opacity:0; flex:0 0 24px; width:24px; height:24px; padding:0; border:0; background:transparent; color:var(--text-secondary); cursor:pointer;} .bone-row:hover .row-control,.bone-row:focus-within .row-control,.bone-row.selected .row-control {opacity:1;} .drag-handle {flex-basis:16px; width:16px; cursor:grab; touch-action:none; font-size:11px;} .trash:hover {color:var(--danger); background:var(--bg-hover);} .dragging {opacity:.5;} .drop-before {box-shadow:inset 0 2px var(--accent);} .drop-after {box-shadow:inset 0 -2px var(--accent);} .drop-inside {outline:1px solid var(--accent); outline-offset:-1px; background:var(--accent-dim);} .row-menu {margin-left:auto; flex:0 0 24px; border:0; color:var(--text-secondary); background:transparent; cursor:pointer; font-size:18px;} .row-menu:hover,.row-menu:focus-visible {color:var(--accent); background:var(--bg-hover);} .rename {width:0; flex:1; min-width:30px; padding:2px 4px; color:var(--text-primary); background:var(--bg-surface); border:1px solid var(--accent); font:inherit;} .name {flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;}`,
})
export class RigLayersComponent implements AfterViewChecked, DoCheck, OnDestroy {
    readonly gripIcon = faGripVertical;
    readonly trashIcon = faTrash;
    readonly drag = new RowPointerDrag<BoneRow>();
    drop?: { row:BoneRow; position:RowDropPosition };
    private dragDocument?: object;
    private dragRevision = 0;
    private suppressClick = false;
    renaming?: BoneRow;
    private renameDocument?: object;
    private focusRename = false;
    private focusAfterDelete?: string;
    collapsed = new Set<string>();
    constructor(public rig: RigEditingService, public session: RigBindingSessionService, private host: ElementRef<HTMLElement>, private mutations: DocumentMutationService) {}
    get rows(): BoneRow[] {
        const rows: BoneRow[] = [];
        for(const rig of this.rig.armatures) {
            const root = rig.bones.find(bone => bone.id === rig.id && bone.parentId === null);
            const visit = (parentId: string | null, depth: number) => {
                rig.bones.filter(bone => bone.parentId === parentId && bone !== root).forEach(bone => {
                    const id = rig.id + ':' + bone.id, children = rig.bones.some(item => item.parentId === bone.id);
                    rows.push({ id, rigId: rig.id, boneId: bone.id, name: bone.name, point: bone.kind === 'point', depth, children });
                    if(!this.collapsed.has(id)) visit(bone.id, depth + 1);
                });
            };
            const id = rig.id + ':root';
            rows.push({ id, rigId: rig.id, boneId: root?.id ?? rig.bones[0]?.id ?? '', name: rig.name, point: true, depth: 0, children: rig.bones.length > (root ? 1 : 0) });
            if(!this.collapsed.has(id)) { visit(root?.id ?? null, 1); if(root) visit(null, 1); }
        }
        return rows;
    }
    track(_index: number, row: BoneRow) { return row.id; }
    selected(row: BoneRow): boolean { return row.rigId === this.rig.activeId && row.boneId === this.rig.boneId; }
    choose(row: BoneRow): void { if(this.suppressClick) { this.suppressClick = false; return; } this.session.toggle(row.rigId, row.boneId); }
    beginDrag(event: PointerEvent,row: BoneRow): void {
        if(event.button !== 0 || this.renaming || this.session.pending || !this.rig.canEdit) return;
        event.stopPropagation(); this.suppressClick = false;
        const element = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-bone-row]'); if(!element) return;
        this.dragDocument = this.rig.editor.selectedSVG; this.dragRevision = this.mutations.revision;
        this.drag.begin(event,element,row);
    }
    moveDrag(event: PointerEvent): void {
        const source = this.drag.move(event); if(!source) return; event.stopPropagation(); this.drop = undefined;
        const target = document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-bone-row]');
        if(!target || !this.host.nativeElement.contains(target)) return;
        const row = this.rows.find(row => row.id === target.dataset['boneRow']); if(!row || row.id === source.id) return;
        if(source.depth === 0 ? row.depth !== 0 : row.rigId !== source.rigId) return;
        const position = source.depth > 0 && row.depth === 0 ? 'inside' : rowDropPosition(target.getBoundingClientRect(),event.clientY,source.depth > 0);
        this.drop = {row,position};
    }
    finishDrag(event: PointerEvent): void {
        const pending = this.drag.pending; if(!pending || pending.pointerId !== event.pointerId) return;
        this.ngDoCheck(); if(!this.drag.pending) return;
        this.moveDrag(event); const drop = this.drop, source = pending.value, moved = pending.started;
        this.cancelDrag(); this.suppressClick = moved;
        if(moved) setTimeout(() => this.suppressClick = false);
        if(moved && drop) {
            this.rig.moveLayerRow(source.rigId,source.depth === 0 ? null : source.boneId,drop.row.rigId,drop.row.depth === 0 ? null : drop.row.boneId,drop.position);
            if(drop.position === 'inside') this.collapsed.delete(drop.row.id);
        }
    }
    @HostListener('window:blur') cancelDrag(): void { this.drag.cancel(); this.drop = undefined; }
    ngOnDestroy(): void { this.cancelDrag(); }
    beginRename(row: BoneRow): void {
        if(this.session.pending || !this.rig.canEdit) return;
        this.renaming = row; this.renameDocument = this.rig.editor.selectedSVG; this.focusRename = true;
    }
    ngAfterViewChecked(): void {
        if(this.focusAfterDelete) { const id = this.focusAfterDelete; this.focusAfterDelete = undefined; this.focus(id); }
        if(!this.focusRename) return;
        const input = this.host.nativeElement.querySelector<HTMLInputElement>('input.rename');
        if(input) { this.focusRename = false; input.focus(); input.select(); }
    }
    ngDoCheck(): void {
        if(this.drag.pending && (this.dragDocument !== this.rig.editor.selectedSVG || this.dragRevision !== this.mutations.revision || !this.rig.canEdit || !!this.session.pending)) this.cancelDrag();
        if(this.renaming && (this.renameDocument !== this.rig.editor.selectedSVG || !this.rows.some(row => row.id === this.renaming!.id && row.name === this.renaming!.name))) this.renaming = undefined;
    }
    finishRename(name?: string, restoreFocus = false): void {
        const row = this.renaming; this.renaming = undefined;
        if(!row) return;
        const current = this.rows.find(item => item.id === row.id);
        if(name !== undefined && this.renameDocument === this.rig.editor.selectedSVG && current?.name === row.name) {
            this.rig.selectBone(row.rigId,row.boneId);
            if(row.depth === 0) this.rig.rename(name); else this.rig.renameBone(name);
        }
        if(restoreFocus) this.focus(row.id);
    }
    renameKey(event: KeyboardEvent): void {
        event.stopPropagation();
        if(event.key === 'Escape' || event.key === 'Enter') {
            event.preventDefault(); this.finishRename(event.key === 'Escape' ? undefined : (event.target as HTMLInputElement).value, true);
        }
    }
    private focus(id: string): void { this.host.nativeElement.querySelector<HTMLElement>('[data-bone-row="' + CSS.escape(id) + '"]')?.focus(); }
    menu(event: MouseEvent, row: BoneRow): void {
        event.preventDefault(); event.stopPropagation(); if(this.session.pending) return;
        this.rig.selectBone(row.rigId,row.boneId);
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        this.rig.editor.openContextMenu(event.clientX || rect.left, event.clientY || rect.bottom, this.menuItems(row));
    }
    menuItems(row: BoneRow): EditorContextMenuItem[] {
        const active = this.rig.active!;
        const parents = [
            {label:'Canvas root', disabled:!this.rig.canReparent(null), action:() => this.rig.reparentBone(null)},
            ...active.bones.filter(bone => this.rig.canReparent(bone.id)).map(bone => ({label:bone.name,action:() => this.rig.reparentBone(bone.id)})),
        ];
        const links: EditorContextMenuItem[] = [
            ...active.bindings.filter(link => row.depth === 0 || link.boneIds?.includes(row.boneId) || link.points.some(point => point.weights.some(weight => weight.boneId === row.boneId)))
                .map(link => ({label:'Unbind ' + this.rig.pathName(link.pathId),action:() => this.rig.unbind(link.pathId)})),
            ...(active.attachments ?? []).filter(link => row.depth === 0 || link.boneId === row.boneId)
                .map(link => ({label:'Detach ' + this.rig.pathName(link.elementId),action:() => this.rig.detach(link.elementId)})),
        ];
        return contextMenuSections(
            [{label:'Rename',shortcut:'F2',action:() => this.beginRename(row)}],
            row.depth === 0 ? [] : [{label:'Move under',children:parents}],
            links,
            [{label:row.depth === 0 ? 'Delete armature' : 'Delete bone',shortcut:'Del',danger:true,action:() => this.remove(row)}],
        );
    }
    remove(row: BoneRow): void {
        if(this.session.pending) return;
        this.rig.selectBone(row.rigId,row.boneId);
        const index = this.rows.findIndex(item => item.id === row.id);
        if(row.depth === 0) this.rig.remove(); else this.rig.deleteBone();
        const remaining = this.rows;
        if(!remaining.some(item => item.id === row.id)) this.focusAfterDelete = remaining[Math.min(index,remaining.length-1)]?.id;
    }
    toggle(id: string): void { if(this.collapsed.has(id)) this.collapsed.delete(id); else this.collapsed.add(id); }
    key(event: KeyboardEvent, row: BoneRow): void {
        if(event.key === 'Escape' && this.drag.pending) { event.preventDefault(); event.stopPropagation(); this.cancelDrag(); return; }
        if(event.target !== event.currentTarget) return;
        if(event.altKey && ['ArrowUp','ArrowDown'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const bones = this.rig.armatures.find(rig => rig.id === row.rigId)?.bones ?? [];
            const parentId = bones.find(bone => bone.id === row.boneId)?.parentId;
            const peers = this.rows.filter(item => row.depth === 0 ? item.depth === 0 : item.depth > 0 && item.rigId === row.rigId && bones.find(bone => bone.id === item.boneId)?.parentId === parentId);
            const target = peers[peers.findIndex(item => item.id === row.id)+(event.key === 'ArrowUp' ? -1 : 1)];
            if(target) this.rig.moveLayerRow(row.rigId,row.depth === 0 ? null : row.boneId,target.rigId,target.depth === 0 ? null : target.boneId,event.key === 'ArrowUp' ? 'before' : 'after');
            return;
        }
        if(event.key === 'F2') { event.preventDefault(); event.stopPropagation(); this.beginRename(row); return; }
        if(event.key === 'Delete') { event.preventDefault(); event.stopPropagation(); this.remove(row); return; }
        if(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { this.menu(event as unknown as MouseEvent,row); return; }
        if(['Enter',' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); this.choose(row); return; }
        if(!['ArrowDown','ArrowUp','ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); const rows = this.rows, index = rows.findIndex(item => item.id === row.id);
        if(event.key === 'ArrowRight') { this.collapsed.delete(row.id); return; }
        if(event.key === 'ArrowLeft') { if(row.children) this.collapsed.add(row.id); return; }
        const target = rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        this.host.nativeElement.querySelector<HTMLElement>(`[data-bone-row="${CSS.escape(target.id)}"]`)?.focus();
    }
}
interface BoneRow { id: string; rigId: string; boneId: string; name: string; point: boolean; depth: number; children: boolean; }
