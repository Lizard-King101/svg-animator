/** Retain matching rows and their hierarchy, including matches inside collapsed branches. */
export function filterTimelineHierarchy<T extends { depth: number }>(
    rows: readonly T[], matches: (row: T, ancestors: readonly T[]) => boolean,
): T[] {
    const ancestors: number[] = [], kept = new Set<number>();
    rows.forEach((row, index) => {
        while(ancestors.length && rows[ancestors.at(-1)!].depth >= row.depth) ancestors.pop();
        if(matches(row, ancestors.map(i => rows[i]))) {
            kept.add(index);
            ancestors.forEach(i => kept.add(i));
        }
        ancestors.push(index);
    });
    return rows.filter((_row, index) => kept.has(index));
}

export function adjacentKeyTime(times: readonly number[], current: number, direction: -1 | 1): number | undefined {
    const candidates = times.filter(time => Number.isFinite(time) && (direction < 0 ? time < current - .0005 : time > current + .0005));
    return candidates.length ? (direction < 0 ? Math.max(...candidates) : Math.min(...candidates)) : undefined;
}
