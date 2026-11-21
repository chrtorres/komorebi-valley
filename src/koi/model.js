import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { connectRig } from "./rig.js";
import cranial from "./cranial.json";

const url = new URL("../assets/kohaku.glb", import.meta.url).href;

export async function loadKoiRig() {
  const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  return connectRig(asset, cranial);
}
