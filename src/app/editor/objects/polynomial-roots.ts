export const polynomialValue = (p: number[], t: number): number => p.reduceRight((sum, coefficient) => sum * t + coefficient, 0);
export const polynomialDerivative = (p: number[]): number[] => p.slice(1).map((coefficient, index) => coefficient * (index + 1));

/** Derivative roots partition monotone intervals; stationary roots retain tangent contacts. */
export function rootsInUnitInterval(coefficients: number[]): number[] {
    const p = [...coefficients], magnitude = Math.max(...p.map(Math.abs));
    if(magnitude < 1e-12) return [];
    while(p.length > 1 && Math.abs(p.at(-1)!) < magnitude * 1e-12) p.pop();
    if(p.length === 1) return [];
    if(p.length === 2) {
        const root = -p[0] / p[1];
        return root >= -1e-10 && root <= 1 + 1e-10 ? [Math.max(0, Math.min(1, root))] : [];
    }
    const stops = [0, ...rootsInUnitInterval(polynomialDerivative(p)), 1].sort((a, b) => a - b);
    const roots: number[] = [];
    const add = (root: number) => { if(!roots.some((existing) => Math.abs(existing - root) < 1e-8)) roots.push(root); };
    stops.forEach((t) => { if(Math.abs(polynomialValue(p, t)) < magnitude * 1e-10) add(t); });
    for(let i = 1; i < stops.length; i++) {
        let low = stops[i - 1], high = stops[i], left = polynomialValue(p, low);
        const right = polynomialValue(p, high);
        // A root already accepted at a monotone interval boundary must not spawn
        // extra roots from roundoff sign changes around a repeated root.
        if(Math.abs(left) < magnitude * 1e-10 || Math.abs(right) < magnitude * 1e-10 || left * right >= 0) continue;
        for(let step = 0; step < 48; step++) {
            const mid = (low + high) / 2, sample = polynomialValue(p, mid);
            if(left * sample <= 0) high = mid;
            else { low = mid; left = sample; }
        }
        add((low + high) / 2);
    }
    return roots.sort((a, b) => a - b);
}
