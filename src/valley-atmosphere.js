// The mist integrates density along the view ray and uses the opaque surface as
// its endpoint, so it reads around trees and rocks without translucent fog planes.
const mistFragment = `
  #if defined(USE_FOG) && defined(FOG_EXP2)
    if (valleyMistActive > 0.5) {
      vec3 ray = valleyWorld - cameraPosition;
      float distanceToSurface = max(length(ray), 0.01);
      // A shallow inversion layer sits above the valley floor. The mean of
      // exp(-height) along the ray has a finite limit on level sight lines.
      float low = max(min(cameraPosition.y, valleyWorld.y) - 0.5, 0.0);
      float high = max(max(cameraPosition.y, valleyWorld.y) - 0.5, 0.0);
      float rise = (high - low) * 0.24;
      float meanDensity = exp(-low * 0.24) *
        (rise < 0.04 ? 1.0 - rise * 0.5 : (1.0 - exp(-rise)) / rise);
      vec2 basin = (cameraPosition.xz + ray.xz * 0.55) * vec2(0.011, 0.016);
      float drift = texture2D(valleyVariation, basin).r;
      float depth = distanceToSurface * fogDensity;
      float lowMist = meanDensity * mix(0.003, 0.012, drift) * distanceToSurface;
      float veil = 1.0 - exp(-depth * depth * 0.77 - lowMist);
      float sunward = max(dot(ray / distanceToSurface, valleySun), 0.0);
      float light = pow(sunward, 8.0);
      vec3 mist = mix(valleyAir, valleyWarmMist, 0.75 * light);
      mist = mix(mist, valleyFloorMist, meanDensity * (0.33 + 0.24 * drift));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, mist, veil);
    }
  #endif
`;

const groundDetail = `
  vec2 soilPattern = texture2D(valleyVariation, valleyWorld.xz * 0.033).rg;
  float growth = smoothstep(0.22, 0.79, soilPattern.x * 0.72 + soilPattern.y * 0.28);
  diffuseColor.rgb *= mix(vec3(0.90, 0.79, 0.69), vec3(1.10, 1.20, 1.01), growth);
`;
const pathDetail = `
  vec2 stonePattern = texture2D(valleyVariation, valleyWorld.xz * 0.20).rg;
  float patina = smoothstep(0.34, 0.69, stonePattern.x * 0.62 + stonePattern.y * 0.38);
  diffuseColor.rgb *= mix(vec3(0.76, 0.75, 0.70), vec3(1.17, 1.15, 1.08), patina);
  float moss = smoothstep(0.59, 0.84, stonePattern.x * 0.85 + stonePattern.y * 0.15);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.60, 0.77, 0.60), moss);
`;
const ridgeDetail = `
  vec2 ridgePattern = texture2D(valleyVariation, valleyWorld.xy * vec2(0.012, 0.038)).rg;
  float woodland = ridgePattern.x * 0.72 + ridgePattern.y * 0.28;
  diffuseColor.rgb *= mix(0.65, 1.20, woodland);
`;
const foliageLight = `
  // Light transmitted by thin crowns brings out leaf color on backlit boughs.
  vec3 toEye = normalize(cameraPosition - valleyWorld);
  float transmittance = max(dot(-toEye, valleySun), 0.0);
  float leafGlow = transmittance * transmittance;
  totalEmissiveRadiance += diffuseColor.rgb * vec3(0.62, 0.43, 0.25) *
    leafGlow * (0.39 + 0.17 * transmittance) * valleyMistActive;
`;

function shadeSurface(material, kind, uniforms) {
  const originalCompile = material.onBeforeCompile;
  const detail = { terrain: groundDetail, path: pathDetail, ridge: ridgeDetail }[kind] || "";
  material.onBeforeCompile = function (shader, renderer) {
    originalCompile.call(this, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 valleyWorld;")
      .replace("#include <worldpos_vertex>", `
        #include <worldpos_vertex>
        vec4 valleyPosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          valleyPosition = instanceMatrix * valleyPosition;
        #endif
        valleyWorld = (modelMatrix * valleyPosition).xyz;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `
        #include <common>
        varying vec3 valleyWorld;
        uniform sampler2D valleyVariation;
        uniform vec3 valleySun, valleyAir, valleyWarmMist, valleyFloorMist;
        uniform float valleyMistActive;
      `)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${detail}`)
      .replace("#include <tonemapping_fragment>", `${mistFragment}\n#include <tonemapping_fragment>`)
      .replace("#include <fog_fragment>", `
        if (valleyMistActive < 0.5) {
          #include <fog_fragment>
        }
      `);
    if (kind === "path") {
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", `
        #include <roughnessmap_fragment>
        roughnessFactor *= mix(0.61, 1.0, patina);
      `);
    }
    if (kind === "foliage") {
      shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n${foliageLight}`);
    }
  };
  material.customProgramCacheKey = () => `veiled-pass-${kind}`;
  material.needsUpdate = true;
}

export function enhanceAtmosphere(T, scene, world) {
  if (!world || typeof world.height !== "function") {
    throw new TypeError(
      "enhanceAtmosphere requires a constructed valley world",
    );
  }
  const cached = scene.userData.valleyAtmosphere;
  if (cached) return cached;

  const daylight = scene.getObjectByName("Veiled Pass sunlight") ??
    scene.children.find((object) => object.isDirectionalLight && object.intensity > 0);
  const sunlight = daylight ? daylight.position.clone().sub(daylight.target.position).normalize() :
    new T.Vector3(-31, 33, -62).normalize();
  const skyMaterial = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      sunDirection: { value: sunlight },
      zenith: { value: new T.Color("#3d76b8") },
      horizon: { value: new T.Color("#e6e2d6") },
      lowerSky: { value: new T.Color("#c4d0d4") },
      dawn: { value: new T.Color("#ffb37c") },
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Keep the sky behind all opaque scenery without a gigantic far plane.
        gl_Position.z = gl_Position.w * 0.99999;
      }
    `,
    fragmentShader: `
      uniform vec3 sunDirection;
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 lowerSky;
      uniform vec3 dawn;
      varying vec3 skyDirection;
      float skyHash(vec2 p) {
        vec3 q = fract(vec3(p.xyx) * 0.1031);
        q += dot(q, q.yzx + 33.33);
        return fract((q.x + q.y) * q.z);
      }
      float skyNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), f.x),
                   mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + 1.0), f.x), f.y);
      }
      void main() {
        vec3 direction = normalize(skyDirection);
        float elevation = max(direction.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(elevation, 0.73));
        color = mix(color, lowerSky, 1.0 - smoothstep(-0.25, 0.0, direction.y));
        float alignment = max(dot(direction, sunDirection), 0.0);
        float horizonGlow = (1.0 - smoothstep(0.0, 0.58, elevation)) * pow(alignment, 5.0);
        color = mix(color, dawn, 0.70 * horizonGlow);
        // Project wisps onto a distant, shallow layer fading toward the horizon.
        vec2 cloudUV = direction.xz / max(0.24, direction.y + 0.18) * vec2(2.2, 5.1);
        vec2 vapor = vec2(skyNoise(cloudUV), skyNoise(cloudUV * 3.25));
        float cloud = smoothstep(0.49, 0.73, vapor.x * 0.68 + vapor.y * 0.32);
        cloud *= smoothstep(0.025, 0.24, direction.y) * (1.0 - smoothstep(0.65, 1.0, elevation));
        vec3 cloudTint = mix(vec3(0.63, 0.67, 0.72), vec3(0.93, 0.68, 0.49), horizonGlow);
        color = mix(color, cloudTint, cloud * 0.36);
        float halo = pow(alignment, 35.0) * 0.14 + pow(alignment, 240.0) * 0.28;
        float disc = smoothstep(0.99974, 0.99991, alignment);
        color += vec3(1.0, 0.68, 0.43) * halo;
        color = mix(color, vec3(2.8, 2.1, 1.46), disc);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new T.Mesh(new T.SphereGeometry(1, 32, 16), skyMaterial);
  sky.name = "Valley atmosphere sky";
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  // A camera-centered unit sphere works with either engine camera far distance.
  sky.onBeforeRender = (_renderer, _scene, camera) => {
    sky.position.setFromMatrixPosition(camera.matrixWorld);
    sky.updateMatrixWorld(true);
  };
  scene.add(sky);

  // Tileable, deterministic value noise gives broad moss patches and fine grit.
  // DataTexture avoids browser canvas dependencies in isolated contract tests.
  const hash = (x, y) => {
    let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  };
  function noise(u, v, cells) {
    const x = u * cells,
      y = v * cells;
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const tx = x - ix,
      ty = y - iy;
    const sx = tx * tx * (3 - 2 * tx),
      sy = ty * ty * (3 - 2 * ty);
    const sample = (a, b) => hash((a + cells) % cells, (b + cells) % cells);
    return T.MathUtils.lerp(
      T.MathUtils.lerp(sample(ix, iy), sample(ix + 1, iy), sx),
      T.MathUtils.lerp(sample(ix, iy + 1), sample(ix + 1, iy + 1), sx),
      sy,
    );
  }
  const size = 256,
    soil = new Uint8Array(size * size * 4),
    variation = new Uint8Array(size * size * 4),
    soilRelief = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const broad = noise(u, v, 8),
        medium = noise(u, v, 32);
      const grit = noise(u, v, 128), grains = hash(x, y);
      const brightness =
        0.78 + broad * 0.15 + medium * 0.16 + (grit - 0.5) * 0.19 +
          (grains - 0.5) * 0.115;
      const i = (y * size + x) * 4;
      soil[i] = Math.min(255, brightness * (231 + medium * 19));
      soil[i + 1] = Math.min(255, brightness * (231 + broad * 22));
      soil[i + 2] = Math.min(255, brightness * (222 + medium * 17));
      soil[i + 3] = 255;
      soilRelief[i / 4] = broad * 0.18 + medium * 0.34 + grit * 0.35 + grains * 0.13;
      variation[i] = Math.round(noise(u, v, 5) * 255);
      variation[i + 1] = Math.round(noise(u, v, 21) * 255);
      variation[i + 3] = 255;
    }
  function dataTexture(data, repeat, color = false) {
    const texture = new T.DataTexture(data, size, size, T.RGBAFormat);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.anisotropy = 4;
    if (color) texture.colorSpace = T.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }
  function surfaceMaps(relief, repeat) {
    const normals = new Uint8Array(size * size * 4),
      roughness = new Uint8Array(size * size * 4);
    const sample = (x, y) =>
      relief[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const nx = sample(x - 1, y) - sample(x + 1, y);
        const ny = sample(x, y - 1) - sample(x, y + 1);
        const inverseLength = 1 / Math.hypot(nx, ny, 1),
          i = (y * size + x) * 4;
        normals[i] = Math.round((nx * inverseLength * 0.5 + 0.5) * 255);
        normals[i + 1] = Math.round((ny * inverseLength * 0.5 + 0.5) * 255);
        normals[i + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
        normals[i + 3] = 255;
        // MeshStandardMaterial samples roughness from the green channel.
        roughness[i + 1] = Math.round((0.87 + relief[i / 4] * 0.13) * 255);
        roughness[i + 3] = 255;
      }
    return {
      normalMap: dataTexture(normals, repeat),
      roughnessMap: dataTexture(roughness, repeat),
    };
  }
  const soilTexture = dataTexture(soil, 17, true);
  // Keep broad ground color variation and tile the relief at a finer scale.
  const soilDetail = surfaceMaps(soilRelief, 38);
  const baseFog = scene.fog;
  const uniforms = {
    valleyVariation: { value: dataTexture(variation, 1) },
    valleyMistActive: { value: 1 },
    valleySun: { value: sunlight },
    valleyAir: { value: new T.Color("#b4cad6") },
    valleyWarmMist: { value: new T.Color("#f1c6a2") },
    valleyFloorMist: { value: new T.Color("#c6cbc1") },
  };
  const shaded = new Set();
  function applyShading(object, kind) {
    if (!shaded.has(object.material)) {
      shadeSurface(object.material, kind, uniforms);
      shaded.add(object.material);
    }
    const onBeforeRender = object.onBeforeRender;
    object.onBeforeRender = function (renderer, currentScene, ...args) {
      onBeforeRender.call(this, renderer, currentScene, ...args);
      // The Storm swaps the fog object and uses its own atmosphere.
      uniforms.valleyMistActive.value = currentScene.fog === baseFog && baseFog?.isFogExp2 ? 1 : 0;
    };
  }
  const propDetails = new Map(),
    propMaterials = new Map();
  scene.traverse((object) => {
    const material = object.material;
    if (
      !object.isMesh ||
      !material?.isMeshStandardMaterial ||
      material.isMeshPhysicalMaterial ||
      material.transparent
    )
      return;
    if (
      object.geometry.type === "PlaneGeometry" &&
      object.geometry.getAttribute("color") &&
      material.vertexColors
    ) {
      object.material = material.clone();
      object.material.map = soilTexture;
      Object.assign(object.material, soilDetail);
      object.material.normalScale.setScalar(0.72);
      object.material.roughness = 1;
      applyShading(object, "terrain");
      return;
    }

    // The authored wood and stone batches share two canvas albedos. Derive relief
    // from those patterns so the normals line up with grain and mineral flecks.
    const map = material.map;
    if (
      object.isInstancedMesh ||
      !object.geometry.getAttribute("uv") ||
      !map?.isCanvasTexture ||
      object.geometry.type === "CircleGeometry" ||
      map.image?.width !== size ||
      map.image.height !== size ||
      material.normalMap ||
      material.roughnessMap
    ) {
      if (material.userData.valleySurface) applyShading(object, material.userData.valleySurface);
      return;
    }
    if (!propDetails.has(map)) {
      const pixels = map.image
        .getContext("2d")
        .getImageData(0, 0, size, size).data;
      const relief = new Float32Array(size * size);
      // Match the canvas upload's row order in the DataTexture's UV space.
      for (let y = 0; y < size; y++) {
        const sourceY = map.flipY ? size - 1 - y : y;
        for (let x = 0; x < size; x++) {
          const p = (sourceY * size + x) * 4;
          relief[y * size + x] =
            (pixels[p] * 0.21 + pixels[p + 1] * 0.72 + pixels[p + 2] * 0.07) / 255;
        }
      }
      const detail = surfaceMaps(relief, 1);
      for (const texture of [detail.normalMap, detail.roughnessMap]) {
        texture.repeat.copy(map.repeat);
        texture.offset.copy(map.offset);
        texture.center.copy(map.center);
        texture.rotation = map.rotation;
      }
      propDetails.set(map, detail);
    }
    if (!propMaterials.has(material)) {
      const enhanced = Object.assign(material.clone(), propDetails.get(map));
      enhanced.normalScale.setScalar(material.userData.valleySurface === "path" ? 0.82 : 0.6);
      propMaterials.set(material, enhanced);
    }
    object.material = propMaterials.get(material);
    if (material.userData.valleySurface) applyShading(object, material.userData.valleySurface);
  });

  // Match low-altitude sky haze without replacing the world's fog model/range.
  if (baseFog?.color) baseFog.color.set("#bccfd8");
  scene.userData.valleyAtmosphere = sky;
  return sky;
}
