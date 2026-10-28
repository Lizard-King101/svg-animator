import { RigPhysicsPlan, RigLivePhysics, physicsSampleTime } from '../../../../packages/runtime/src/rig/physics';
import { DEFAULT_SPRING_SETTINGS, springChain, springConstraintsProblem } from '../../../../packages/runtime/src/rig/spring-chain';
import { applyMatrix } from '../objects/transform.object';
import { validRigs, boneMatrices } from '../objects/armature';
import { springFixture, springAnimation } from './spring-motion.spec-support';
import { rigPhysicsSampler } from './rig-physics-sampler';
import { createDocumentEnvelope, migrateDocument } from '../migrations/document-migrations';
import { SVG } from '../objects/svg.object';
import { Point } from '../objects/point.object';
import { Path } from '../objects/elements/path.object';
import { Line } from '../objects/line.object';
import { EditorService } from '../../_services/editor.service';
import { EditorPreferencesService } from '../../_services/editor-preferences.service';
import { createPathBinding } from '../rig-binding';
import { compileRuntimeAnimation } from './runtime-animation-compiler';
import { createPlayer, validateRuntimeBundle } from '../../../../packages/runtime/src';
import { buildSVGMarkup } from '../svg-markup';
import { DocumentRigEvaluationPlan } from '../rig-evaluation';
import { parseFixtureSvg } from './runtime-dom-parity.spec-support';

function fixture() {
    const rig=springFixture(); rig.springs=[{...DEFAULT_SPRING_SETTINGS,id:'spring',name:'Hair',rootBoneId:'hair',enabled:true}];
    return rig;
}
function sample(plan: RigPhysicsPlan,time:number) { return plan.evaluate(time).pose.bones.map(bone=>[bone.pose,bone.poseX??0,bone.poseY??0]); }

describe('persistent live rig physics',()=>{
    it('applies canvas-space wind with independent per-bone response and zero-wind compatibility',()=>{
        const rig=fixture();rig.springs![0].endBoneId='tip';rig.springs![0].gravity=0;
        const still={...springAnimation(),tracks:[]};
        const evaluate=(source:typeof rig)=>new RigPhysicsPlan(source,rigPhysicsSampler(source,still)).evaluate(.5).pose.bones[1].pose;
        const calm=evaluate(rig);expect(calm).toBeCloseTo(0,8);
        rig.windX=5;expect(evaluate(rig)).toBeLessThan(-1);
        rig.springs![0].boneSettings={hair:{...DEFAULT_SPRING_SETTINGS,gravity:0,windInfluence:0}};
        expect(evaluate(rig)).toBeCloseTo(calm,8);
        delete rig.springs![0].boneSettings;rig.bones[1].angle=45;rig.bones[0].pose=90;
        expect(evaluate(rig)).toBeLessThan(-1); // +X remains right after rotating the root.
        rig.bones[0].pose=0;rig.bones[1].angle=0;rig.windX=0;rig.windY=5;
        expect(evaluate(rig)).toBeGreaterThan(1);
        rig.windY=NaN;expect(validRigs({version:6,armatures:[rig]})).toBeFalse();
    });
    it('reconstructs keyed gusts through action boundaries and backwards seeks',()=>{
        const rig=fixture();rig.springs![0].gravity=0;rig.windX=2;
        const source=springAnimation();source.tracks[0].property='physics.windX';
        const scene=springAnimation();scene.tracks=[];scene.duration=3;
        scene.composition={version:1,actions:[{id:'wind',name:'Gust',targetIds:[rig.id],animation:source}],placements:[{id:'gust',actionId:'wind',start:.25}]};
        const sampler=rigPhysicsSampler(rig,scene),create=()=>new RigPhysicsPlan(rig,rigPhysicsSampler(rig,scene)),plan=create();
        expect(sampler(.1).windX).toBe(2);expect(sampler(.55).windX).toBeCloseTo(80,8);expect(sampler(2.5).windX).toBe(2);
        for(const time of [.24,.55,2.5,.12,.55]) expect(sample(plan,time)).toEqual(sample(create(),time));
        expect(rig.windX).toBe(2);
    });
    it('limits physics to an explicit ancestry range while ordinary children and branches follow',()=>{
        const rig=fixture();rig.springs![0].endBoneId='hair';
        rig.bones.push({...rig.bones[2],id:'branch'});
        rig.bones.push({id:'point',name:'Tip control',kind:'point',parentId:'tip',x:30,y:0,angle:0,length:0,pose:0});
        expect(springChain(rig,'hair','hair')).toEqual(['hair']);
        expect(springChain(rig,'hair','tip')).toEqual(['hair','tip']);
        expect(springConstraintsProblem(rig)).toBeUndefined();
        const animation=springAnimation(),plan=new RigPhysicsPlan(rig,rigPhysicsSampler(rig,animation));
        const pose=plan.evaluate(.2).pose;
        expect(Math.abs(pose.bones[1].pose)).toBeGreaterThan(1);
        expect(pose.bones.find(bone=>bone.id==='tip')!.pose).toBe(0);
        expect(pose.bones.find(bone=>bone.id==='branch')!.pose).toBe(0);
        expect(()=>springChain(rig,'tip','hair')).toThrow();
        expect(()=>springChain(rig,'hair','point')).toThrowError(/positive length/);
    });
    it('uses per-bone mix and limits in live and sampled motion without changing authored channels',()=>{
        const rig=fixture();rig.springs![0].endBoneId='tip';
        rig.springs![0].boneSettings={hair:{...DEFAULT_SPRING_SETTINGS,mix:0},tip:{...DEFAULT_SPRING_SETTINGS,limit:3}};
        const original=JSON.stringify(rig), sampler=rigPhysicsSampler(rig,springAnimation()),plan=new RigPhysicsPlan(rig,sampler);
        const live=new RigLivePhysics(rig);
        for(let i=1;i<40;i++) {
            for(const pose of [plan.evaluate(i/120).pose,live.advance(sampler(i/120),1/120).pose]) {
                expect(pose.bones[1].pose).toBe(0);expect(Math.abs(pose.bones[2].pose)).toBeLessThanOrEqual(3.000001);
            }
        }
        expect(JSON.stringify(rig)).toBe(original);
        rig.springs![0].boneSettings!.root={...DEFAULT_SPRING_SETTINGS};
        expect(springConstraintsProblem(rig)).toContain('outside the range');
    });
    it('solves IK after its target point follows physics, and springs below IK after that solve',()=>{
        const rig=fixture();rig.springs![0].endBoneId='tip';
        rig.bones.push(
            {id:'target',name:'Follower target',kind:'point',parentId:'tip',x:30,y:0,angle:0,length:0,pose:0},
            {id:'upper',name:'Upper',parentId:'root',x:0,y:0,angle:0,length:60,pose:0},
            {id:'lower',name:'Lower',parentId:'upper',x:60,y:0,angle:0,length:60,pose:0},
            {id:'tail',name:'Tail',parentId:'lower',x:60,y:0,angle:0,length:20,pose:0},
        );
        rig.constraints=[{id:'a-ik',name:'Follower',type:'two-bone-ik',enabled:true,upperBoneId:'upper',lowerBoneId:'lower',targetBoneId:'target',bend:1}];
        rig.springs!.push({...DEFAULT_SPRING_SETTINGS,id:'a-tail',name:'Tail',enabled:true,rootBoneId:'tail',endBoneId:'tail'});
        expect(springConstraintsProblem(rig)).toBeUndefined();
        const sampler=rigPhysicsSampler(rig,springAnimation()),plan=new RigPhysicsPlan(rig,sampler),live=new RigLivePhysics(rig);
        const check=(pose:ReturnType<RigPhysicsPlan['evaluate']>['pose'])=>{
            const matrices=boneMatrices(pose), end=applyMatrix(matrices.get('lower')!,60,0),target=applyMatrix(matrices.get('target')!,0,0);
            expect(end.x).toBeCloseTo(target.x,7);expect(end.y).toBeCloseTo(target.y,7);
        };
        for(const time of [.15,.27341,.8,.03,.27341]) check(plan.evaluate(time).pose);
        for(let i=1;i<=30;i++) check(live.advance(sampler(i/120),1/120).pose);
        const reversed=structuredClone(rig);reversed.springs!.reverse();
        expect(sample(new RigPhysicsPlan(reversed,rigPhysicsSampler(reversed,springAnimation())),.27341)).toEqual(sample(plan,.27341));
        rig.springs![0].endBoneId='tip';rig.constraints![0].upperBoneId='hair';rig.constraints![0].lowerBoneId='tip';rig.constraints![0].targetBoneId='root';
        expect(springConstraintsProblem(rig)).toContain('cannot also be driven by IK');
    });
    it('matches direct seeks and refresh-rate-independent playback including checkpoint eviction',()=>{
        const rig=fixture(), animation=springAnimation(); animation.duration=40;
        const create=()=>new RigPhysicsPlan(rig,rigPhysicsSampler(rig,animation));
        const sequential=create();
        for(let t=0;t<1;t+=1/144) sample(sequential,t);
        const reference=sample(create(),.98761); expect(sample(sequential,.98761)).toEqual(reference);
        sample(sequential,36); expect(sample(sequential,.98761)).toEqual(reference);
        sample(sequential,2); expect(sample(sequential,0)).toEqual(sample(create(),0));
    });
    it('carries inertia through forward loop seams and preserves exact authored endpoints',()=>{
        const rig=fixture(), animation=springAnimation();animation.duration=.6;
        const plan=new RigPhysicsPlan(rig,rigPhysicsSampler(rig,animation)),loop={start:0,end:.6};
        const before=plan.evaluate(.599,loop).pose.bones[1].pose;
        const after=plan.evaluate(.601,loop).pose.bones[1].pose;
        expect(Math.abs(after-before)).toBeLessThan(5);
        expect(Math.abs(after)).toBeGreaterThan(1);
        expect(physicsSampleTime(.6,loop)).toBe(.6);
        expect(physicsSampleTime(1.2,loop)).toBe(.6);
        expect(physicsSampleTime(.61,loop)).toBeCloseTo(.01,10);
    });
    it('validates versioned settings, references, overlap, and upgrades old envelopes',()=>{
        const rig=fixture();expect(validRigs({version:6,armatures:[rig]})).toBeTrue();expect(validRigs({version:5,armatures:[rig]})).toBeFalse();
        const bad=structuredClone(rig);bad.springs![0].damping=NaN;expect(validRigs({version:6,armatures:[bad]})).toBeFalse();
        bad.springs![0].damping=8;bad.springs![0].rootBoneId='missing';expect(validRigs({version:6,armatures:[bad]})).toBeFalse();
        const editor=new EditorService(new EditorPreferencesService()),svg=new SVG(editor,{width:200,height:200,pos:new Point(0,0)});
        svg.rigs={version:6,armatures:[rig]};const envelope=createDocumentEnvelope(svg.save());
        expect(envelope.version).toBe(19);expect(migrateDocument(envelope).status).toBe('ok');
        const old={...envelope,version:18,data:{...envelope.data,rigs:{version:5 as const,armatures:[springFixture()]}}};
        expect(migrateDocument(old).status).toBe('ok');
    });
    it('exports physics without keys and matches editor deformation on random seeks',()=>{
        const editor=new EditorService(new EditorPreferencesService()),svg=new SVG(editor,{width:200,height:200,pos:new Point(0,0)}),path=new Path(editor);
        path.lines=[new Line(editor,{type:'line',points:[new Point(0,40,'joint'),new Point(0,70,'end')]})];
        svg.elements=[path];const rig=fixture();rig.springs![0].endBoneId='tip';rig.springs![0].boneSettings={tip:{...DEFAULT_SPRING_SETTINGS,stiffness:30,gravity:2,mix:.7}};rig.bindings=[createPathBinding(svg,path,'tip')];svg.rigs={version:6,armatures:[rig]};svg.animation=springAnimation();
        svg.animation.tracks.push({...structuredClone(svg.animation.tracks[0]),id:'wind',property:'physics.windX',keyframes:[{id:'w0',time:0,value:0},{id:'w1',time:.4,value:6},{id:'w2',time:1,value:-2}]});
        const result=compileRuntimeAnimation(svg.save());expect(result.diagnostics).toEqual([]);
        expect(result.bundle.requiredCapabilities).toContain('rig.wind-v1');expect(result.bundle.requiredCapabilities).toContain('rig.spring-v1');expect(()=>validateRuntimeBundle(result.bundle)).not.toThrow();
        const root=parseFixtureSvg(buildSVGMarkup(svg,{runtime:{signature:result.bundle.artwork.signature}}));
        const player=createPlayer(root,result.bundle,{loop:false});
        const plan=new DocumentRigEvaluationPlan(svg,svg.animation);
        try {
            for(const time of [.27341,1.8,.03,0,2.013,.27341]) {
                plan.apply(undefined,time);player.seek(time);
                const runtimePath=(player as any).scene.targets.find((target:any)=>target.id===path.id).path;
                const end=runtimePath.contours[0].lines[0].points[1];
                expect(end.x).toBeCloseTo(path.findPointById('end')!.x,7);expect(end.y).toBeCloseTo(path.findPointById('end')!.y,7);
            }
            player.loop=true; player.seek(svg.animation.duration-.01); (player as any).advance(.02);
            plan.apply(undefined,svg.animation.duration+.01,{start:0,end:svg.animation.duration});
            const loopEnd=(player as any).scene.targets.find((target:any)=>target.id===path.id).path.contours[0].lines[0].points[1];
            expect(loopEnd.x).toBeCloseTo(path.findPointById('end')!.x,7);
            expect(loopEnd.y).toBeCloseTo(path.findPointById('end')!.y,7);
            player.stop(); expect((player as any).scene.targets.find((target:any)=>target.id===path.id).path.contours[0].lines[0].points[1].x).toBeCloseTo(0,8);
        } finally {player.destroy();}
        svg.animation.tracks=[];rig.bones[1].angle=0;
        // Compile against rest artwork again, so the fixture contains no residual deformed points.
        path.findPointById('joint')!.x=40;path.findPointById('joint')!.y=0;path.findPointById('end')!.x=70;path.findPointById('end')!.y=0;
        rig.bindings=[createPathBinding(svg,path,'tip')];rig.springs![0].gravity=4;
        const staticResult=compileRuntimeAnimation(svg.save());
        expect(staticResult.diagnostics).toEqual([]);
        expect(staticResult.bundle.rigs?.armatures.length).toBe(1);expect(staticResult.bundle.animation.tracks).toEqual([]);
        const staticRoot=parseFixtureSvg(buildSVGMarkup(svg,{runtime:{signature:staticResult.bundle.artwork.signature}}));
        const staticPlayer=createPlayer(staticRoot,staticResult.bundle,{loop:false});
        staticPlayer.seek(.5);
        expect((staticPlayer as any).scene.targets.find((target:any)=>target.id===path.id).path.contours[0].lines[0].points[1].y).toBeGreaterThan(1);
        staticPlayer.destroy();
        const missingWind=structuredClone(result.bundle);missingWind.requiredCapabilities=missingWind.requiredCapabilities.filter(value=>value!=='rig.wind-v1');expect(()=>validateRuntimeBundle(missingWind)).toThrowError(/rig.wind-v1/);
        const missing=structuredClone(result.bundle);missing.requiredCapabilities=missing.requiredCapabilities.filter(value=>value!=='rig.spring-v1');
        expect(()=>validateRuntimeBundle(missing)).toThrowError(/rig.spring-v1/);
    });
    it('replays placed-action boundaries without carrying sampled channel values into the base pose',()=>{
        const rig=fixture(), source=springAnimation(), animation=springAnimation();animation.tracks=[];
        animation.composition={version:1,actions:[{id:'action',name:'Move',targetIds:['rig'],animation:source}],placements:[{id:'placed',actionId:'action',start:.25}]};
        animation.duration=3;
        const create=()=>new RigPhysicsPlan(rig,rigPhysicsSampler(rig,animation)), plan=create();
        for(const time of [.24,.25,.6,2.2629,2.263,2.5,.24,2.5]) expect(sample(plan,time)).toEqual(sample(create(),time));
        expect(rig.bones[0].poseX).toBeUndefined();
    });
});
