import { WeightBrushPoint, WeightBrushStroke } from './rig-weight-brush';

describe('weight painting strokes', () => {
    const point = (key = 'p', x = 0, amount = .5): WeightBrushPoint => ({ key, pathId: 'path', pointId: key, x, y: 0, boneIds: ['a', 'b'], weights: [{ boneId: 'a', weight: amount }, { boneId: 'b', weight: 1-amount }].filter(entry => entry.weight > 0) });
    const settings = { mode: 'add' as const, boneId: 'a', radius: 20, strength: .25, value: 1 };
    const amount = (stroke: WeightBrushStroke) => stroke.updates()[0]?.weights.find(entry => entry.boneId === 'a')?.weight ?? 0;

    it('paints from frozen weights and normalizes the other influences proportionally', () => {
        const source = point(); source.weights = [{ boneId:'a', weight:.2 },{ boneId:'b', weight:.2 },{ boneId:'c', weight:.6 }]; source.boneIds.push('c');
        const stroke = new WeightBrushStroke([source], { ...settings, strength:.3 });
        source.weights[0].weight = .9;
        stroke.sample({x:0,y:0});
        const weights=stroke.updates()[0].weights;
        expect(weights.map(entry=>entry.boneId)).toEqual(['a','b','c']);
        expect(weights[0].weight).toBeCloseTo(.5,12); expect(weights[1].weight).toBeCloseTo(.125,12); expect(weights[2].weight).toBeCloseTo(.375,12);
    });
    it('covers the entire swept segment even when pointer events skip over a point', () => {
        const stroke = new WeightBrushStroke([point('middle',50)], settings);
        stroke.sample({x:0,y:0},{x:100,y:0});
        expect(amount(stroke)).toBe(.75);
    });
    it('uses screen pixels for radius and is independent of repeated or subdivided samples', () => {
        const samples = [point('near',0),point('outside',21)];
        const one = new WeightBrushStroke(samples,settings), repeated = new WeightBrushStroke(samples,settings);
        one.sample({x:0,y:0});
        for(let i=0;i<20;i++) repeated.sample({x:0,y:0});
        expect(repeated.updates()).toEqual(one.updates());
        expect(one.updates().length).toBe(1);
        const sweep = new WeightBrushStroke([point('p',50)],settings), subdivided = new WeightBrushStroke([point('p',50)],settings);
        sweep.sample({x:0,y:0},{x:100,y:0});
        subdivided.sample({x:0,y:0},{x:50,y:0}); subdivided.sample({x:50,y:0},{x:100,y:0});
        expect(subdivided.updates()).toEqual(sweep.updates());
    });
    it('deduplicates shared owners using their strongest brush coverage', () => {
        const shared = point('shared',15), duplicate = {...point('shared',0), pointId:'shared'};
        const stroke = new WeightBrushStroke([shared,duplicate],settings); stroke.sample({x:0,y:0});
        expect(stroke.updates().length).toBe(1); expect(amount(stroke)).toBe(.75);
    });
    it('supports subtract, set, and smooth with the same normalized baseline', () => {
        const subtract = new WeightBrushStroke([point()],{...settings,mode:'subtract'}); subtract.sample({x:0,y:0}); expect(amount(subtract)).toBe(.25);
        const set = new WeightBrushStroke([point()],{...settings,mode:'set',value:0,strength:.5}); set.sample({x:0,y:0}); expect(amount(set)).toBe(.25);
        const smooth = new WeightBrushStroke([point('low',0,0),point('high',10,1)],{...settings,mode:'smooth',strength:1}); smooth.sample({x:0,y:0});
        expect(smooth.updates()[0].weights.find(entry => entry.boneId==='a')!.weight).toBeCloseTo(1/3,10);
    });
    it('smooths shared owners deterministically across anchor and handle locations', () => {
        const points=[point('shared',0,.2),point('shared',50,.2),point('neighbor',10,.8)];
        const a=new WeightBrushStroke(points,{...settings,mode:'smooth',strength:1}), b=new WeightBrushStroke([...points].reverse(),{...settings,mode:'smooth',strength:1});
        a.sample({x:0,y:0},{x:50,y:0}); b.sample({x:0,y:0},{x:50,y:0});
        expect(a.updates().find(entry=>entry.pointId==='shared')).toEqual(b.updates().find(entry=>entry.pointId==='shared'));
    });
    it('leaves disallowed influences, zero strength, untouched points and saturated weights unchanged', () => {
        const missing = {...point(),boneIds:['b']};
        for(const [points, config] of [[[missing],settings],[[point()],{...settings,strength:0}],[[point('p',100)],settings],[[point('p',0,1)],settings]] as const) {
            const stroke = new WeightBrushStroke(points,config); stroke.sample({x:0,y:0}); expect(stroke.updates()).toEqual([]);
        }
    });
    it('redistributes a fully weighted point to assigned zero-weight influences when subtracting', () => {
        const stroke=new WeightBrushStroke([point('p',0,1)],{...settings,mode:'subtract',strength:.4});
        stroke.sample({x:0,y:0});
        expect(stroke.updates()[0].weights).toEqual([{boneId:'a',weight:.6},{boneId:'b',weight:.4}]);
    });
    it('preserves frozen locked influences and caps the active bone at the unlocked budget', () => {
        const source={...point(),boneIds:['a','b','c'],lockedBoneIds:['b'],weights:[{boneId:'a',weight:.2},{boneId:'b',weight:.6},{boneId:'c',weight:.2}]};
        const stroke=new WeightBrushStroke([source],{...settings,strength:1});
        source.lockedBoneIds=[];
        stroke.sample({x:0,y:0});
        expect(stroke.updates()[0].weights).toEqual([{boneId:'a',weight:.4},{boneId:'b',weight:.6}]);
        for(const mode of ['add','subtract','set','smooth'] as const) {
            const locked=new WeightBrushStroke([{...point(),lockedBoneIds:['a']}],{...settings,mode});
            locked.sample({x:0,y:0}); expect(locked.updates()).withContext(mode).toEqual([]);
        }
    });
});
