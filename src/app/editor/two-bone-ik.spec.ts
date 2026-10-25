import { Armature, boneMatrices } from './objects/armature';
import { applyMatrix } from './objects/transform.object';
import { solveTwoBoneIK, twoBoneChain } from './two-bone-ik';

describe('two-bone IK solver', () => {
    function rig():Armature { return {id:'rig',name:'Arm',bindings:[],bones:[
        {id:'root',name:'Root',kind:'point',parentId:null,x:20,y:30,angle:25,length:0,pose:15},
        {id:'upper',name:'Upper',parentId:'root',x:10,y:5,angle:10,length:40,pose:0},
        {id:'lower',name:'Lower',parentId:'upper',x:40,y:0,angle:0,length:30,pose:0},
    ]}; }
    const endpoint=(r:Armature) => applyMatrix(boneMatrices(r).get('lower')!,30,0);
    it('reaches targets beneath a translated/rotated ancestor without changing rest lengths', () => {
        const source=rig(), before=structuredClone(source), target=applyMatrix(boneMatrices(source).get('root')!,40,45);
        const solved=solveTwoBoneIK(source,'lower',target,1)!;
        expect(endpoint(solved).x).toBeCloseTo(target.x); expect(endpoint(solved).y).toBeCloseTo(target.y);
        expect(source).toEqual(before); expect(solved.bones.map(b=>b.length)).toEqual([0,40,30]);
    });
    it('flips elbows while retaining the same endpoint', () => {
        const source=rig(), target=applyMatrix(boneMatrices(source).get('root')!,40,45);
        const a=solveTwoBoneIK(source,'lower',target,1)!, b=solveTwoBoneIK(source,'lower',target,-1)!;
        expect(endpoint(a).x).toBeCloseTo(endpoint(b).x); expect(endpoint(a).y).toBeCloseTo(endpoint(b).y);
        expect(a.bones[2].pose).toBeGreaterThan(0); expect(b.bones[2].pose).toBeLessThan(0);
    });
    it('clamps outer and inner reach and stays finite at the root', () => {
        const source=rig(), shoulder=applyMatrix(boneMatrices(source).get('upper')!,0,0);
        const far=solveTwoBoneIK(source,'lower',{x:shoulder.x+1000,y:shoulder.y},1)!;
        expect(Math.hypot(endpoint(far).x-shoulder.x,endpoint(far).y-shoulder.y)).toBeCloseTo(70);
        const near=solveTwoBoneIK(source,'lower',shoulder,-1)!;
        expect(Math.hypot(endpoint(near).x-shoulder.x,endpoint(near).y-shoulder.y)).toBeCloseTo(10);
        source.bones[2].length=40; const folded=solveTwoBoneIK(source,'lower',shoulder,1)!;
        expect(folded.bones.every(b=>Number.isFinite(b.pose))).toBeTrue();
        const end=applyMatrix(boneMatrices(folded).get('lower')!,40,0); expect(end.x).toBeCloseTo(shoulder.x); expect(end.y).toBeCloseTo(shoulder.y);
    });
    it('rejects point bones, disconnected chains and nonfinite targets', () => {
        const source=rig(); expect(twoBoneChain(source,'upper')).toBeUndefined();
        source.bones[2].x=20; expect(twoBoneChain(source,'lower')).toBeUndefined(); source.bones[2].x=40;
        expect(solveTwoBoneIK(source,'lower',{x:Infinity,y:0},1)).toBeUndefined();
    });
});
