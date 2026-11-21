import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import decoderScript from "three/addons/libs/draco/gltf/draco_wasm_wrapper.js?url";
import decoderBinary from "three/addons/libs/draco/gltf/draco_decoder.wasm?url";
const assets = {
  yoshino: new URL("./assets/sakura-yoshino.glb", import.meta.url).href,
  kanzan: new URL("./assets/sakura-kanzan.glb", import.meta.url).href,
  shidarezakura: new URL("./assets/sakura-shidarezakura.glb", import.meta.url).href,
};
const pending = new Map();
let loader;
export function loadSpecimen(T, variety) {
  if (!loader) {
    const manager = new T.LoadingManager().setURLModifier(url => {
      if (url === "draco_wasm_wrapper.js") return decoderScript;
      if (url === "draco_decoder.wasm") return decoderBinary;
      return url;
    });
    loader = new GLTFLoader(manager).setDRACOLoader(new DRACOLoader(manager)
      .setDecoderConfig({ type: "wasm" }).setWorkerLimit(2));
  }
  if (!pending.has(variety)) {
    pending.set(variety, loader.loadAsync(assets[variety]).then(({ scene }) => ({
      scene, height: new T.Box3().setFromObject(scene).max.y,
    })));
  }
  return pending.get(variety);
}
