import { createPlayer, RuntimeBundleV1 } from "../packages/runtime/src/index";
import bundleJson from "../fixtures/runtime-showcase-v1/runtime-bundle-v1.json";

const player = createPlayer("#showcase", bundleJson as RuntimeBundleV1);
player.on("marker", ({ marker, direction }) => console.log(direction, marker.name));
player.setPlaybackRate(1).setLoop(true).play();

window.addEventListener("pagehide", () => player.destroy(), { once: true });
