/** Rewrite only SVG resource/ARIA references, never visible text or color values. */
export function rewriteLocalIdReferences(value: string, ids: ReadonlyMap<string, string>, attributeName: string): string {
    let rewritten = value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/gi, (match, quote: string, id: string) => {
        const replacement = ids.get(id);
        return replacement ? `url(${quote}#${replacement}${quote})` : match;
    });
    if((attributeName === 'href' || attributeName === 'xlink:href') && rewritten.startsWith('#')) {
        const replacement = ids.get(rewritten.slice(1));
        if(replacement) rewritten = `#${replacement}`;
    }
    if(attributeName === 'aria-labelledby' || attributeName === 'aria-describedby') {
        rewritten = rewritten.split(/\s+/).map((id) => ids.get(id) ?? id).join(' ');
    }
    return rewritten;
}
