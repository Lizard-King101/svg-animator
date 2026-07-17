export interface WebBundleHtmlOptions {
    runtimeFilename?: "svg-animator-runtime.js" | "svg-animator-runtime.min.js";
    runtimeRevision?: string;
}

export function buildWebBundleHtml(title: string, options: WebBundleHtmlOptions = {}): string {
    const runtimeFilename = options.runtimeFilename ?? "svg-animator-runtime.min.js";
    const runtimeRevision = options.runtimeRevision ? `?v=${encodeURIComponent(options.runtimeRevision)}` : "";
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title>
<style>body{font:14px system-ui;margin:2rem;background:#111;color:#eee}object{display:block;max-width:100%;background:white}button{margin:.75rem .25rem 0 0}</style></head>
<body><object id="artwork" data="artwork.svg" type="image/svg+xml"></object>
<button id="play">Play</button><button id="pause">Pause</button><button id="stop">Stop</button><pre id="events"></pre>
<script src="runtime/${runtimeFilename}${runtimeRevision}"></script>
<script>
Promise.all([fetch('animation.json').then(r=>r.json()),new Promise(resolve=>artwork.addEventListener('load',resolve,{once:true}))]).then(([bundle])=>{
 const svg=artwork.contentDocument.documentElement;
 const player=SVGAnimatorRuntime.createPlayer(svg,bundle);
 play.onclick=()=>player.play(); pause.onclick=()=>player.pause(); stop.onclick=()=>player.stop();
 player.on('marker',event=>events.textContent+='marker: '+event.marker.name+'\\n');
});
</script></body></html>`;
}

export function buildWebBundleReadme(title: string): string {
    return `# ${title} web bundle

Serve this directory over HTTP and open \`index.html\`. It includes the runtime-bound artwork, portable \`RuntimeBundleV1\` JSON, ESM and browser-global players, controls, and marker logging.

Do not open the page through \`file://\`; browser fetch and SVG document policies require HTTP. The SVG and JSON should be served as \`image/svg+xml\` and \`application/json\`. Review your Content Security Policy before allowing scripts or external fetches.

Artwork using Plus Jakarta Sans loads it from Google Fonts inside the SVG document so \`<object>\` and standalone SVG rendering match the editor. Allow \`fonts.googleapis.com\` and \`fonts.gstatic.com\` in your CSP and keep network access available, or change the artwork to a locally available font before export.

Script-bearing SVG animates when navigated to directly or embedded with \`<object>\`/\`<iframe>\`. Browsers do not execute SVG scripts loaded through \`<img>\` or CSS backgrounds.
`;
}

function escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
