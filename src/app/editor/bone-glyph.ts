/** Screen-space bone silhouette shared by committed bones and creation previews. */
export function boneDiamond(start: { x: number; y: number }, end: { x: number; y: number }): string {
    const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
    if(length < .001) return '';
    const width = Math.min(9, length * .16), x = start.x + dx * .23, y = start.y + dy * .23;
    return `${start.x},${start.y} ${x - dy / length * width},${y + dx / length * width} ${end.x},${end.y} ${x + dy / length * width},${y - dx / length * width}`;
}
