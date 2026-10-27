import { AnimationTrack, createDefaultAnimation, evaluateTemporalSpeed, restoreAnimation } from '../objects/animation.object';
import { linkLoopSeam, loopEndpoints, remapLoopSeam, syncDocumentLoopSeams, syncLoopSeam } from './loop-seam';

function track(): AnimationTrack {
    return { id:'t', targetId:'shape', property:'transform.translateX', valueType:'number', keyframes:[
        {id:'a',time:0,value:10}, {id:'b',time:.5,value:80}, {id:'c',time:1,value:20},
    ] };
}
describe('linked loop seams', () => {
    it('uses the chosen boundary, keeps interior keys and updates values bidirectionally', () => {
        const t = track(); linkLoopSeam(t,0,1,'end',false);
        expect(t.keyframes.map(key=>key.value)).toEqual([20,80,20]);
        t.keyframes[0].value=35; syncLoopSeam(t,undefined,'a');
        expect(t.keyframes[2].value).toBe(35);
        const before=structuredClone(t); t.keyframes[2].value=55; syncLoopSeam(t,before);
        expect(t.keyframes[0].value).toBe(55);
        expect(t.keyframes.map(key=>key.time)).toEqual([0,.5,1]);
    });
    it('creates sampled boundary keys without replacing interior identity', () => {
        const t=track(); linkLoopSeam(t,.1,.9,'start',false);
        const pair=loopEndpoints(t)!;
        expect(pair.start.value).toBeCloseTo(24); expect(pair.end.value).toEqual(pair.start.value);
        expect(t.keyframes.find(key=>key.id==='b')?.value).toBe(80);
    });
    it('matches seam velocity in either direction while preserving independent influences', () => {
        const t=track();
        t.keyframes[0].temporal={linked:false,out:{speed:12,influence:.2}};
        t.keyframes[2].temporal={linked:false,in:{speed:-3,influence:.4}};
        linkLoopSeam(t,0,1,'start',true);
        expect(t.keyframes[2].temporal!.in).toEqual({speed:12,influence:.4});
        const before=structuredClone(t); t.keyframes[2].temporal!.in!.speed=8;
        syncLoopSeam(t,before);
        expect(t.keyframes[0].temporal!.out).toEqual({speed:8,influence:.2});
        expect(evaluateTemporalSpeed(t.keyframes[0],t.keyframes[1],0)).toBeCloseTo(8);
        expect(evaluateTemporalSpeed(t.keyframes[1],t.keyframes[2],1)).toBeCloseTo(8);
    });
    it('does not turn Hold into interpolated motion or force smoothness on discrete channels', () => {
        const t=track(); t.keyframes[0].easing={type:'hold'}; linkLoopSeam(t,0,1,'start',true);
        expect(t.keyframes[0].temporal).toBeUndefined();
        const discrete=track(); discrete.valueType='boolean'; discrete.keyframes.forEach(key=>key.value=true);
        linkLoopSeam(discrete,0,1,'start',true); expect(discrete.loopSeam?.smooth).toBeFalse();
    });
    it('removes dangling links after deletion without recreating deleted keys', () => {
        const t=track(); linkLoopSeam(t,0,1,'start',false);
        t.keyframes.pop(); syncLoopSeam(t); expect(t.loopSeam).toBeUndefined(); expect(t.keyframes.length).toBe(2);
    });
    it('preserves links through serialization and remaps independent copies', () => {
        const t=track(); linkLoopSeam(t,0,1,'start',true);
        const animation={...createDefaultAnimation(),tracks:[t]};
        const restored=restoreAnimation(JSON.parse(JSON.stringify(animation))).tracks[0];
        expect(restored.loopSeam).toEqual(t.loopSeam);
        const ids=new Map(restored.keyframes.map(key=>[key.id,`${key.id}-copy`]));
        restored.keyframes.forEach(key=>key.id=ids.get(key.id)!); remapLoopSeam(restored,ids);
        expect(loopEndpoints(restored)?.end.id).toBe('c-copy'); expect(loopEndpoints(t)?.end.id).toBe('c');
    });
    it('reconciles action channels independently of scene channels', () => {
        const t=track(); linkLoopSeam(t,0,1,'start',false);
        const animation=createDefaultAnimation();
        animation.composition={version:1,placements:[],actions:[{id:'act',name:'Loop',targetIds:['shape'],animation:{...createDefaultAnimation(),tracks:[t]}}]};
        const previous=structuredClone(animation); t.keyframes[2].value=72;
        syncDocumentLoopSeams(animation,previous); expect(t.keyframes[0].value).toBe(72); expect(animation.tracks).toEqual([]);
    });
});
