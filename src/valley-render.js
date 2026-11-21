import {
  Color, HalfFloatType, UnsignedByteType, Vector2, WebGLRenderTarget,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

export const GRAPHICS_TIERS = ["balanced", "cinematic", "ultra-4k"];

export function graphicsScale(width, height, screenRatio, tier, hardwareLimit) {
  const ultra = tier === "ultra-4k";
  const high = ultra || tier === "cinematic";
  const cap = high ? [3840, 2160] : [2560, 1440];
  const maximum = Math.min(cap[0] / width, cap[1] / height, hardwareLimit / Math.max(width, height));
  return Math.min(maximum, ultra ? maximum : Math.min(screenRatio, high ? 2 : 1.5));
}

const gradeShader = {
  name: "ValleyGrade",
  uniforms: {
    tDiffuse: { value: null },
    lift: { value: new Color() },
    highlights: { value: new Color() },
  },
  vertexShader: `
    varying vec2 uvScreen;
    void main() {
      uvScreen = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 lift;
    uniform vec3 highlights;
    varying vec2 uvScreen;
    void main() {
      vec3 color = texture2D(tDiffuse, uvScreen).rgb;
      float value = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 grade = color * mix(lift, highlights, smoothstep(0.04, 0.82, value));
      vec2 frame = (uvScreen - 0.5) * vec2(1.05, 0.82);
      float falloff = 1.0 - 0.12 * smoothstep(0.25, 0.59, length(frame));
      gl_FragColor = vec4(grade * falloff, 1.0);
    }
  `,
};

export function createValleyRender(renderer, scene, camera) {
  const gl = renderer.getContext();
  const limit = Math.min(renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
    ...gl.getParameter(gl.MAX_VIEWPORT_DIMS));
  const hdr = renderer.extensions.has("EXT_color_buffer_float");
  const buffers = new WebGLRenderTarget(1, 1, { type: hdr ? HalfFloatType : UnsignedByteType, samples: 0 });
  const composer = new EffectComposer(renderer, buffers);
  const bloom = new UnrealBloomPass(new Vector2(1, 1), .22, .65, 1.05);
  bloom.enabled = hdr;
  const grade = new ShaderPass(gradeShader);
  const antialias = new ShaderPass(FXAAShader);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(grade);
  composer.addPass(new OutputPass());
  // FXAA reads perceptual contrast. Run it after the linear-to-display conversion.
  composer.addPass(antialias);

  const drawing = new Vector2();
  let pipelineWidth = 0, pipelineHeight = 0, currentScene;
  let usePostProcessing = false;
  return {
    resize(width, height, screenRatio, tier) {
      // An 8-bit intermediate would clip the scene before the ACES transform.
      usePostProcessing = hdr && tier !== "balanced";
      const scale = graphicsScale(width, height, screenRatio, tier, limit);
      renderer.setDrawingBufferSize(width, height, scale);
      renderer.getDrawingBufferSize(drawing);
      if (!usePostProcessing && pipelineWidth) {
        // A player switching back to Balanced can reclaim the UHD post targets immediately.
        composer.setSize(1, 1);
        pipelineWidth = pipelineHeight = 0;
      } else if (usePostProcessing && (drawing.x !== pipelineWidth || drawing.y !== pipelineHeight)) {
        // The composer uses physical pixels so the antialias kernel stays one texel wide at UHD.
        pipelineWidth = drawing.x;
        pipelineHeight = drawing.y;
        composer.setSize(pipelineWidth, pipelineHeight);
        antialias.uniforms.resolution.value.set(1 / pipelineWidth, 1 / pipelineHeight);
      }
    },
    render(storm, dt) {
      if (!usePostProcessing) {
        renderer.render(scene, camera);
        return;
      }
      if (storm !== currentScene) {
        currentScene = storm;
        grade.uniforms.lift.value.setRGB(...(storm ? [.93, .99, 1.08] : [.97, 1.01, 1.045]));
        grade.uniforms.highlights.value.setRGB(...(storm ? [.99, 1.025, 1.045] : [1.035, 1.012, .97]));
        bloom.strength = storm ? .23 : .18;
        bloom.threshold = storm ? 1.12 : 1.02;
      }
      composer.render(dt);
    },
    get resolution() {
      return {
        width: drawing.x, height: drawing.y, antiAlias: usePostProcessing ? "fxaa" : "native",
        postWidth: pipelineWidth,
        postHeight: pipelineHeight,
      };
    },
  };
}
