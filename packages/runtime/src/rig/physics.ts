import { Armature } from './armature';
import { RigEvaluationPlan } from './evaluation-plan';
import { rigMotionOrder } from './motion-plan';
import { springChain, springConstraintsProblem, SpringChainSimulation, SPRING_STEP } from './spring-chain';

export interface PhysicsLoop { start: number; end: number; }
export function physicsSampleTime(time: number, loop?: PhysicsLoop): number {
    const span = loop ? loop.end - loop.start : 0;
    if(!loop || span <= 0 || time <= loop.end) return time;
    const phase=(time-loop.start)%span;
    return phase < 1e-10 ? loop.end : loop.start+phase;
}
export const hasPhysics = (rig: Armature) => !!rig.springs?.some(spring => spring.enabled && (spring.mix>0 || Object.values(spring.boneSettings??{}).some(settings=>settings.mix>0)));

/** One fixed-step workspace shared by timeline replay and interactive posing. */
export class RigSpringSimulation {
    private readonly skeleton: RigEvaluationPlan;
    private readonly chains = new Map<string, SpringChainSimulation>();
    private readonly order;
    constructor(source: Armature) {
        const problem = springConstraintsProblem(source); if(problem) throw new Error(problem);
        this.skeleton = new RigEvaluationPlan(source);
        this.order=rigMotionOrder(source,(source.springs??[]).map(constraint=>({constraint,ids:springChain({...source,constraints:[]},constraint.rootBoneId,constraint.endBoneId)})));
        for(const step of this.order) if(step.kind==='spring') this.chains.set(step.constraint.id,new SpringChainSimulation(step.ids,step.constraint,step.constraint.boneSettings));
    }
    reset(): void { this.chains.forEach(chain => chain.reset()); }
    snapshot() { return [...this.chains].map(([id,chain])=>({id,state:chain.snapshot()})); }
    restore(snapshot: ReturnType<RigSpringSimulation['snapshot']>): void { for(const {id,state} of snapshot) this.chains.get(id)!.restore(state); }
    private solve(source: Armature, spring: (id: string, pose: Armature) => Map<string, number>): Armature {
        const pose=this.skeleton.evaluatePose(source,false).pose;
        for(const step of this.order) {
            if(step.kind==='ik') this.skeleton.solveConstraint(step.constraint.id);
            else for(const [id,value] of spring(step.constraint.id,pose)) pose.bones.find(bone=>bone.id===id)!.pose=value;
        }
        pose.constraintsActive=true;
        return pose;
    }
    step(source: Armature): Map<string, number> {
        const offsets=new Map<string,number>();
        this.solve(source,(id,pose)=>{
            const values=this.chains.get(id)!.step(pose);
            for(const [boneId,value] of values) offsets.set(boneId,value-pose.bones.find(bone=>bone.id===boneId)!.pose);
            return values;
        });
        return offsets;
    }
    /** Project interpolated spring offsets and solve downstream IK at display time. */
    pose(source: Armature, offsets: ReadonlyMap<string,number>): Armature {
        return this.solve(source,(id,pose)=>new Map(this.chains.get(id)!.ids.map(boneId=>[boneId,pose.bones.find(bone=>bone.id===boneId)!.pose+(offsets.get(boneId)??0)])));
    }
}

/** Lazy fixed-step evaluation with bounded checkpoints. Same timeline time yields
 * the same pose regardless of refresh cadence or seek order. Forward loops use a
 * monotonically increasing clock and wrap only the authored input, retaining inertia.
 */
export class RigPhysicsPlan {
    readonly output: RigEvaluationPlan;
    private readonly simulation: RigSpringSimulation;
    private stepIndex = -1;
    private previous = new Map<string, number>();
    private current = new Map<string, number>();
    private loopKey = '';
    private checkpoints = new Map<number, { state: ReturnType<RigSpringSimulation['snapshot']>; offsets: Map<string, number> }>();
    constructor(source: Armature, private readonly sample: (time: number) => Armature) {
        this.simulation = new RigSpringSimulation(source);
        this.output = new RigEvaluationPlan(source);
    }
    reset(): void { this.simulation.reset(); this.stepIndex = -1; this.checkpoints.clear(); this.current.clear(); this.previous.clear(); }
    evaluate(time: number, loop?: PhysicsLoop): RigEvaluationPlan {
        if(!Number.isFinite(time) || time < 0) throw new Error('Invalid physics time.');
        const key=loop ? `${loop.start}:${loop.end}` : 'none';
        if(this.loopKey!==key) { this.reset(); this.loopKey=key; }
        const lower = Math.floor(time / SPRING_STEP + 1e-9), upper = lower + 1;
        if(this.stepIndex > upper) {
            const nearest = [...this.checkpoints.keys()].filter(index => index <= lower).sort((a,b) => b-a)[0];
            if(nearest === undefined) { this.simulation.reset(); this.stepIndex = -1; this.current = new Map(); }
            else {
                const checkpoint = this.checkpoints.get(nearest)!;
                this.simulation.restore(checkpoint.state); this.stepIndex = nearest; this.current = checkpoint.offsets;
            }
        }
        while(this.stepIndex < upper) {
            this.previous = this.current;
            this.current = this.simulation.step(this.sample(physicsSampleTime(++this.stepIndex * SPRING_STEP, loop)));
            if(this.stepIndex % 120 === 0) {
                this.checkpoints.set(this.stepIndex, { state: this.simulation.snapshot(), offsets: new Map(this.current) });
                while(this.checkpoints.size > 32) this.checkpoints.delete(this.checkpoints.keys().next().value!);
            }
        }
        const fraction = Math.max(0, Math.min(1, time / SPRING_STEP - lower));
        const offsets=new Map<string,number>();
        for(const [id,b] of this.current) {
            const a=this.previous.get(id)??0; offsets.set(id,a+(b-a)*fraction);
        }
        const pose=this.simulation.pose(this.sample(physicsSampleTime(time,loop)),offsets);
        this.output.evaluate(pose, false); this.output.pose.constraintsActive=true;
        return this.output;
    }
}

/** Interactive Pose input is deliberately history-dependent, unlike a timeline seek. */
export class RigLivePhysics {
    private readonly simulation: RigSpringSimulation;
    readonly output: RigEvaluationPlan;
    private accumulated = 0;
    private offsets = new Map<string, number>();
    private previous = new Map<string, number>();
    constructor(source: Armature) {
        this.simulation = new RigSpringSimulation(source); this.output = new RigEvaluationPlan(source);
        this.offsets = this.simulation.step(source);
    }
    advance(source: Armature, seconds: number): RigEvaluationPlan {
        // Hidden-tab stalls do not launch unbounded interactive catch-up work.
        this.accumulated += Math.max(0, Math.min(.1, seconds));
        while(this.accumulated >= SPRING_STEP) { this.previous=this.offsets; this.offsets = this.simulation.step(source); this.accumulated -= SPRING_STEP; }
        return this.preview(source);
    }
    /** Pointer previews use the current simulation state without advancing its clock. */
    preview(source: Armature): RigEvaluationPlan {
        const offsets=new Map<string,number>();
        for(const [id,b] of this.offsets) {
            const a=this.previous.get(id)??0; offsets.set(id,a+(b-a)*this.accumulated/SPRING_STEP);
        }
        const pose=this.simulation.pose(source,offsets);
        this.output.evaluate(pose, false); this.output.pose.constraintsActive=true;
        return this.output;
    }
}
