import { DEFAULT_SPRING_SETTINGS, springChain, SpringChainSimulation } from '../../../../packages/runtime/src/rig/spring-chain';
import { generateSpringMotion } from './spring-motion';
import { AnimationEvaluationPlan } from './animation-evaluation-plan';

import { springFixture, springAnimation } from './spring-motion.spec-support';
const immediate = () => Promise.resolve();

describe('spring motion generation', () => {
    it('reacts to root translation, preserves inputs, limits local angles and includes the exact endpoint', async () => {
        const rig = springFixture(), animation = springAnimation(), before = JSON.stringify({rig, animation});
        const tracks = await generateSpringMotion(rig, animation, 'hair', {...DEFAULT_SPRING_SETTINGS, limit: 25}, immediate);
        expect(tracks.length).toBe(2);
        expect(tracks[0].keyframes.some(key => Math.abs(Number(key.value)) > 1)).toBeTrue();
        for(const track of tracks) {
            expect(track.keyframes.every(key => Math.abs(Number(key.value)) <= 25 + 1e-8)).toBeTrue();
            expect(track.keyframes.at(-1)!.time).toBe(animation.duration);
        }
        expect(JSON.stringify({rig, animation})).toBe(before);
    });
    it('generates repeatable motion and continuous-time keys that agree on forward and backward seeks', async () => {
        const rig = springFixture(), animation = springAnimation();
        const generate = () => generateSpringMotion(rig, animation, 'hair', DEFAULT_SPRING_SETTINGS, immediate);
        const a = await generate(), b = await generate();
        expect(a.map(track => track.keyframes.map(key => [key.time,key.value]))).toEqual(b.map(track => track.keyframes.map(key => [key.time,key.value])));
        const plan = new AnimationEvaluationPlan({...animation, tracks:a}, [], {version:5,armatures:[rig]});
        const sample = (time: number) => plan.evaluate(time).map(value => value.value);
        const at = sample(.27341); sample(1.9); sample(0);
        expect(sample(.27341)).toEqual(at);
        expect(sample(.27342)).not.toEqual(at);
    });
    it('leaves no keys for zero mix or a stationary gravity-free chain', async () => {
        expect(await generateSpringMotion(springFixture(), springAnimation(), 'hair', {...DEFAULT_SPRING_SETTINGS,mix:0}, immediate)).toEqual([]);
        expect(await generateSpringMotion(springFixture(), {...springAnimation(),tracks:[]}, 'hair', {...DEFAULT_SPRING_SETTINGS,gravity:0}, immediate)).toEqual([]);
    });
    it('settles after motion, and reset restores the authored starting pose', () => {
        const rig = springFixture(), simulation = new SpringChainSimulation(['hair','tip'], {...DEFAULT_SPRING_SETTINGS,gravity:0});
        simulation.step(rig); rig.bones[0].poseX = 35;
        const disturbed = simulation.step(rig);
        expect(Math.abs(disturbed.get('hair')!)).toBeGreaterThan(1);
        let settled = disturbed;
        for(let i=0;i<1200;i++) settled = simulation.step(rig);
        expect(Math.abs(settled.get('hair')!)).toBeLessThan(.1);
        simulation.reset(); expect([...simulation.step(rig).values()]).toEqual([0,0]);
    });
    it('rejects branches, point controls, bad settings and IK dependencies', async () => {
        const rig = springFixture();
        expect(() => springChain(rig,'root')).toThrowError(/positive length/);
        rig.bones.push({...rig.bones[2],id:'branch'});
        expect(() => springChain(rig,'hair')).toThrowError(/unbranched/);
        rig.bones.pop();
        rig.constraints = [{id:'ik',name:'IK',type:'two-bone-ik',enabled:true,upperBoneId:'hair',lowerBoneId:'tip',targetBoneId:'root',bend:1}];
        expect(() => springChain(rig,'hair')).toThrowError(/IK/);
        expect(() => new SpringChainSimulation(['hair'], {...DEFAULT_SPRING_SETTINGS,damping:NaN})).toThrowError(/damping/);
        await expectAsync(generateSpringMotion(springFixture(), {...springAnimation(),duration:61}, 'hair', DEFAULT_SPRING_SETTINGS, immediate)).toBeRejectedWithError(/60 seconds/);
    });
    it('yields bounded work and lets the owner cancel before any output is applied', async () => {
        let yields = 0;
        await expectAsync(generateSpringMotion(springFixture(), springAnimation(), 'hair', DEFAULT_SPRING_SETTINGS, async () => {
            if(++yields === 2) throw new Error('Canceled');
        })).toBeRejectedWithError('Canceled');
        expect(yields).toBe(2);
    });
    it('uses an upstream IK solve as the driver without modifying its authored channels', async () => {
        const rig=springFixture();
        rig.bones.push(
            {id:'upper',name:'Upper',parentId:'root',x:0,y:0,angle:0,length:40,pose:0},
            {id:'lower',name:'Lower',parentId:'upper',x:40,y:0,angle:0,length:40,pose:0},
            {id:'target',name:'Target',kind:'point',parentId:'root',x:60,y:20,angle:0,length:0,pose:0},
        );
        rig.bones[1].parentId='lower'; rig.bones[1].x=40;
        rig.constraints=[{id:'ik',name:'Arm',type:'two-bone-ik',enabled:true,upperBoneId:'upper',lowerBoneId:'lower',targetBoneId:'target',bend:1}];
        const animation=springAnimation(); animation.tracks[0].property='bones.target.poseY';
        const original=JSON.stringify(rig);
        const tracks=await generateSpringMotion(rig,animation,'hair',DEFAULT_SPRING_SETTINGS,immediate);
        expect(tracks.map(track=>track.property)).toEqual(['bones.hair.pose','bones.tip.pose']);
        expect(tracks[0].keyframes.some(key=>Math.abs(Number(key.value))>1)).toBeTrue();
        expect(JSON.stringify(rig)).toBe(original);
    });
    it('rejects generated rigid-attachment skew before offering any preview or bake', async () => {
        const rig=springFixture();
        rig.attachments=[{elementId:'clip',boneId:'hair',parentMatrix:{a:2,b:0,c:0,d:1,e:0,f:0},worldMatrix:{a:2,b:0,c:0,d:1,e:0,f:0},
            restTransform:{translateX:0,translateY:0,rotation:0,scaleX:1,scaleY:1,originX:0,originY:0}}];
        await expectAsync(generateSpringMotion(rig,springAnimation(),'hair',DEFAULT_SPRING_SETTINGS,immediate)).toBeRejectedWithError(/skew/);
    });
});
