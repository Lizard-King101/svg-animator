import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { DEFAULT_SPRING_SETTINGS, springChain, springBoneSettings, SpringSettings, validateSpringSettings } from '../../../packages/runtime/src/rig/spring-chain';
import { hasPhysics, RigLivePhysics } from '../../../packages/runtime/src/rig/physics';
import { generateSpringMotion } from '../editor/animation/spring-motion';
import { replaceAnimationTracks } from '../editor/animation/track-overrides';
import { rigAnimationBaseProblem, rigAnimationProperty } from '../editor/rig-animation';
import { documentRigChannelProblem } from '../editor/rig-animation-conflicts';
import { poseStructure } from '../editor/animation/rig-pose';
import { ImperativeSvgRenderer } from '../editor/animation/imperative-svg-renderer';
import { Armature } from '../editor/objects/armature';
import { SVG } from '../editor/objects/svg.object';
import { findAnimationTarget } from '../editor/objects/animation-targets';
import { AnimationPlaybackService } from './animation-playback.service';
import { DocumentMutationService } from './document-mutation.service';
import { RigEditingService } from './rig-editing.service';

/** Saved spring commands and inspector-lifetime Pose simulation. Timeline physics
 * belongs to the shared evaluator and does not depend on this view being mounted. */
@Injectable()
export class RigSpringService implements OnDestroy {
    busy = false;
    message = '';
    private generation = 0;
    private frame?: number;
    private live?: { svg: SVG; source: Armature; key: string; simulation: RigLivePhysics; renderer: ImperativeSvgRenderer; time?: number };
    private readonly releasePhysicsPreview: () => void;
    private draftEnd?: {key: string; id: string};
    private readonly releaseBaseRestorer: () => void;
    constructor(public rig: RigEditingService, public playback: AnimationPlaybackService, private mutations: DocumentMutationService, private zone?: NgZone) {
        this.releaseBaseRestorer = playback.registerBaseRestorer(() => rig.clearPhysicsPreview());
        this.releasePhysicsPreview=rig.registerPhysicsPreview(source=>{
            const live=this.live;
            return live && live.source===rig.active && live.svg===rig.editor.selectedSVG && rig.canEdit && rig.workspace==='pose' ? live.simulation.preview(source) : undefined;
        });
    }
    get constraint() {
        return this.rig.active?.springs?.find(spring => {
            if(spring.rootBoneId === this.rig.boneId) return true;
            try { return springChain({...this.rig.active!,constraints:[]}, spring.rootBoneId,spring.endBoneId).includes(this.rig.boneId ?? ''); } catch { return false; }
        });
    }
    get settings(): SpringSettings { return {...DEFAULT_SPRING_SETTINGS,...(this.constraint ? springBoneSettings(this.constraint,this.rig.boneId!) : {})}; }
    get endBoneId(): string {
        const constraint=this.constraint;
        if(constraint) return constraint.endBoneId ?? springChain({...this.rig.active!,constraints:[]},constraint.rootBoneId).at(-1)!;
        return this.draftEnd?.key===`${this.rig.activeId}:${this.rig.boneId}` ? this.draftEnd.id : this.rig.boneId??'';
    }
    get startName(): string { return this.rig.active?.bones.find(bone=>bone.id===(this.constraint?.rootBoneId??this.rig.boneId))?.name??''; }
    get endOptions() {
        const rig=this.rig.active, start=this.constraint?.rootBoneId??this.rig.boneId;
        if(!rig || !start) return [];
        const children=new Map<string, typeof rig.bones>();
        for(const bone of rig.bones) if(bone.parentId) {
            const siblings=children.get(bone.parentId)??[]; siblings.push(bone); children.set(bone.parentId,siblings);
        }
        const first=rig.bones.find(bone=>bone.id===start), result: typeof rig.bones=[];
        const visit=(bone:typeof rig.bones[number],depth:number)=>{
            if(depth>32 || bone.kind==='point' || bone.length<=0) return;
            result.push(bone); for(const child of children.get(bone.id)??[]) visit(child,depth+1);
        };
        if(first) visit(first,1);
        return result;
    }
    get chainBones() {
        const rig=this.rig.active; if(!rig || !this.rig.boneId) return [];
        try { return springChain({...rig,constraints:[]},this.constraint?.rootBoneId??this.rig.boneId,this.endBoneId).map(id=>rig.bones.find(bone=>bone.id===id)!); }
        catch { return []; }
    }
    selectSettingsBone(id: string): void { if(this.chainBones.some(bone=>bone.id===id)) this.rig.selectBone(this.rig.activeId!,id); }
    setEnd(id: string): void {
        if(!this.rig.canEdit || !this.endOptions.some(bone=>bone.id===id) || (id===this.endBoneId && !!this.constraint?.endBoneId)) return;
        const constraint=this.constraint;
        if(!constraint) { this.draftEnd={key:`${this.rig.activeId}:${this.rig.boneId}`,id}; return; }
        const ids=springChain({...this.rig.active!,constraints:[]},constraint.rootBoneId,id);
        const next={...constraint,endBoneId:id,boneSettings:Object.fromEntries(Object.entries(constraint.boneSettings??{}).filter(([boneId])=>ids.includes(boneId)))};
        this.cancel(); this.stopLive();
        if(this.rig.setSpringConstraint(next) && !ids.includes(this.rig.boneId!)) this.rig.selectBone(this.rig.activeId!,constraint.rootBoneId);
        this.message=this.rig.message;
    }
    get problem(): string {
        if(!this.rig.active || !this.rig.boneId) return 'Select the first bone of a range.';
        try { springChain(this.rig.active, this.constraint?.rootBoneId ?? this.rig.boneId, this.endBoneId); } catch(error) { return (error as Error).message; }
        return '';
    }
    get chainLabel(): string { return this.chainBones.map(bone=>bone.name).join(' → '); }
    add(): void {
        if(!this.rig.canEdit || this.problem || this.constraint) return;
        const endBoneId=this.endBoneId;
        this.stopLive();
        this.rig.setSpringConstraint({ ...DEFAULT_SPRING_SETTINGS, id:this.rig.editor.ID, name:`${this.rig.bone!.name} spring`, rootBoneId:this.rig.boneId!, endBoneId, enabled:true });
        this.message = this.rig.message;
    }
    setSetting(key: keyof SpringSettings, value: number): void {
        if(!this.constraint || !this.rig.canEdit || this.settings[key] === value) return;
        const settings={...this.settings,[key]:value};
        try { validateSpringSettings(settings); } catch { return; }
        // Store only settings, never the containing constraint's IDs or other overrides.
        const {stiffness,damping,gravity,limit,mix,windInfluence}=settings;
        const next={...this.constraint,endBoneId:this.endBoneId,boneSettings:{...this.constraint.boneSettings,[this.rig.boneId!]:{stiffness,damping,gravity,limit,mix,windInfluence}}};
        this.cancel(); this.stopLive(); this.rig.setSpringConstraint(next); this.message = this.rig.message;
    }
    enable(enabled: boolean): void {
        if(!this.constraint || !this.rig.canEdit || this.constraint.enabled === enabled) return;
        const next={...this.constraint,enabled}; this.cancel(); this.stopLive(); this.rig.setSpringConstraint(next); this.message=this.rig.message;
    }
    remove(): void {
        if(!this.constraint || !this.rig.canEdit) return;
        const constraint=this.constraint; this.cancel(); this.stopLive(); this.rig.setSpringConstraint(constraint,true); this.message=this.rig.message;
    }
    checkContext(): void {
        const rig=this.rig.active, svg=this.rig.editor.selectedSVG;
        const shouldRun=!!rig && !!svg && this.rig.canEdit && this.rig.workspace==='pose' && hasPhysics(rig);
        if(!shouldRun) { this.stopLive(); return; }
        const key=JSON.stringify([svg!.id,rig!.id,poseStructure(rig!),rig!.constraints,rig!.springs,rig!.bindings,rig!.attachments]);
        if(this.live?.key !== key || this.live.source !== rig || this.live.svg !== svg) {
            this.stopLive();
            try { this.live={key,svg:svg!,source:rig!,simulation:new RigLivePhysics(rig!),renderer:new ImperativeSvgRenderer(svg!)}; }
            catch(error) { this.message=(error as Error).message; return; }
        }
        if(this.frame === undefined) {
            const schedule=()=>this.frame=requestAnimationFrame(time=>this.tick(time));
            if(this.zone) this.zone.runOutsideAngular(schedule); else schedule();
        }
    }
    private tick(time: number): void {
        this.frame=undefined;
        const live=this.live, input=this.rig.physicsInput, svg=this.rig.editor.selectedSVG;
        if(!live || !input || !svg || svg!==live.svg || this.rig.active!==live.source || !this.rig.canEdit || this.rig.workspace!=='pose') { this.stopLive(); return; }
        try {
            const evaluation=live.simulation.advance(input,live.time===undefined?0:(time-live.time)/1000); live.time=time;
            this.rig.showPhysicsPreview(evaluation);
            for(const id of [...evaluation.paths.keys(),...evaluation.transforms.keys()]) {
                const target=findAnimationTarget(svg.elements,id); if(target) live.renderer.markDirty(target);
            }
            live.renderer.flush();
            this.frame=requestAnimationFrame(next=>this.tick(next));
        } catch(error) { this.stopLive(); this.message=(error as Error).message; }
    }
    reset(): void { this.stopLive(); this.checkContext(); }
    private stopLive(): void {
        if(this.frame!==undefined) cancelAnimationFrame(this.frame); this.frame=undefined;
        if(this.live) this.rig.clearPosePreview();
        if(this.live) {
            const source=this.live.source, svg=this.live.svg;
            for(const id of [...source.bindings.map(binding=>binding.pathId),...(source.attachments??[]).map(link=>link.elementId)]) {
                const target=findAnimationTarget(svg.elements,id); if(target) this.live.renderer.markDirty(target);
            }
            this.live.renderer.flush(); this.live.renderer.destroy();
        }
        this.live=undefined;
    }
    get bakeProblem(): string {
        if(!this.rig.isAnimating) return 'Switch to Animate only if you want editable baked keys.';
        if(!this.constraint?.enabled) return 'Enable a spring constraint first.';
        if(this.playback.playing) return 'Pause playback before baking.';
        if(!this.playback.allowsTarget(this.rig.activeId!)) return 'Open an action that includes this rig.';
        if(this.playback.activeAnimation?.composition?.placements.length) return 'Bake in the source action when using placed actions.';
        return this.problem;
    }
    /** Optional conversion. Disable this constraint in the same undo entry to avoid applying it twice. */
    async bake(): Promise<void> {
        if(this.bakeProblem || this.busy) return;
        this.message=''; this.busy=true;
        const generation=++this.generation, svg=this.rig.editor.selectedSVG!, source=this.rig.active!, context=this.playback.activeAnimation!, selectedBone=this.rig.boneId;
        const revision=this.mutations.revision, playbackRevision=this.playback.revision, spring={...this.constraint!};
        const stale=()=>generation!==this.generation || selectedBone!==this.rig.boneId || this.playback.playing || svg!==this.rig.editor.selectedSVG || source!==this.rig.active || context!==this.playback.activeAnimation || revision!==this.mutations.revision || playbackRevision!==this.playback.revision;
        try {
            const input=this.playback.withBaseState(()=>{
                const problem=rigAnimationBaseProblem(svg,new Set([source.id])) ?? documentRigChannelProblem(svg,source.id,rigAnimationProperty(spring.rootBoneId,'pose'));
                if(problem) throw new Error(problem);
                return {rig:structuredClone(source),animation:structuredClone(context)};
            });
            const tracks=await generateSpringMotion(input.rig,input.animation,spring.rootBoneId,spring,async()=>{
                await new Promise<void>(resolve=>setTimeout(resolve,0)); if(stale()) throw new Error('Bake canceled.');
            });
            if(stale()) return;
            this.mutations.mutate(()=>{
                this.playback.restorePreview();
                context.tracks=replaceAnimationTracks(context,tracks);
                source.springs!.find(item=>item.id===spring.id)!.enabled=false;
                this.playback.invalidate();
            },'animation');
            this.playback.previewAt(this.playback.currentTime);
            this.message='Baked to editable keys and disabled the live constraint. Undo restores both.';
        } catch(error) { if(generation===this.generation) this.message=(error as Error).message; }
        finally { if(generation===this.generation) this.busy=false; }
    }
    cancel(): void { this.generation++; this.busy=false; this.message=''; }
    ngOnDestroy(): void { this.cancel(); this.stopLive(); this.releaseBaseRestorer(); this.releasePhysicsPreview(); }
}
