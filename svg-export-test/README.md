# Animation Example web bundle

Serve this directory over HTTP and open `index.html`. It includes the runtime-bound artwork, portable `RuntimeBundleV1` JSON, ESM and browser-global players, controls, and marker logging.

Do not open the page through `file://`; browser fetch and SVG document policies require HTTP. The SVG and JSON should be served as `image/svg+xml` and `application/json`. Review your Content Security Policy before allowing scripts or external fetches.

Artwork using Plus Jakarta Sans loads it from Google Fonts inside the SVG document so `<object>` and standalone SVG rendering match the editor. Allow `fonts.googleapis.com` and `fonts.gstatic.com` in your CSP and keep network access available, or change the artwork to a locally available font before export.

Script-bearing SVG animates when navigated to directly or embedded with `<object>`/`<iframe>`. Browsers do not execute SVG scripts loaded through `<img>` or CSS backgrounds.
