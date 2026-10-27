// Adjacent slots intentionally use separated hues so resolving a collision remains easy to see.
const PALETTE_HUES = [18, 205, 140, 285, 50, 175, 335, 100, 250, 0, 75, 315];
const allocations = new Map<string, ReadonlyMap<string, string>>();

/** Pass every bone in the rig, not just the binding's influences, for distinct and stable colors. */
export function boneWeightColor(boneId: string, rigBoneIds?: readonly string[]): string {
    if(!rigBoneIds) return color(hashId(boneId) % 360);
    const ids = [...new Set([...rigBoneIds, boneId])].sort(), key = JSON.stringify(ids);
    let palette = allocations.get(key);
    if(!palette) {
        const assigned = new Map<string, string>(), slots = new Set<number>();
        for(const id of ids) {
            let slot = hashId(id) % PALETTE_HUES.length;
            for(let probe = 0; probe < PALETTE_HUES.length && slots.has(slot); probe++) slot = (slot + 1) % PALETTE_HUES.length;
            if(slots.has(slot)) { slot = PALETTE_HUES.length; while(slots.has(slot)) slot++; }
            slots.add(slot);
            const hue = PALETTE_HUES[slot] ?? ((slot - PALETTE_HUES.length + .5) * 137.50776405003785) % 360;
            assigned.set(id, color(hue));
        }
        // Keep a small cache for frequently projected rigs without retaining every document ever opened.
        if(allocations.size >= 16) allocations.delete(allocations.keys().next().value!);
        allocations.set(key, assigned); palette = assigned;
    }
    return palette.get(boneId)!;
}

/** The conventional weight-paint ramp: blue at 0%, through green, to red at 100%. */
export function weightHeatColor(weight: number): string { return `hsl(${Math.round(240 * (1 - Math.max(0, Math.min(1, weight))))} 85% 55%)`; }
export const WEIGHT_HEAT_GRADIENT = `linear-gradient(90deg, ${[0, .25, .5, .75, 1].map(weightHeatColor).join(', ')})`;

function color(hue: number): string { return `hsl(${hue} 72% 62%)`; }
function hashId(boneId: string): number {
    let hash = 2166136261;
    for(const character of boneId) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
}
