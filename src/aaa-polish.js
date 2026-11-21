// Presentation layer for the AAA pass. Everything here is visual or feel-only:
// it never moves the player, changes combat outcomes, or writes saves, so the
// deterministic gameplay contracts in combat-core / storm-campaign stay intact.
// The single exception is `timeScale`, a hit-stop the frame loop may apply.

const PEAK = { x: 60, z: -560, radius: 400, height: 330 };

/** Snow-capped stratovolcano silhouette rising out of the far mist. */
function createPeak(T) {
  const profile = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    // Concave flank that steepens toward a truncated crater rim.
    const r = PEAK.radius * (0.075 + 0.925 * Math.pow(1 - t, 1.85));
    profile.push(new T.Vector2(r, t * PEAK.height));
  }
  profile.push(new T.Vector2(0.0001, PEAK.height * 0.985));
  const geometry = new T.LatheGeometry(profile, 160);
  const p = geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), t = y / PEAK.height;
    // Erosion gullies: radial ridges that fade near the summit.
    const gully = Math.sin(a * 23) * 0.5 + Math.sin(a * 57 + 1.3) * 0.3 + Math.sin(a * 9 + 4) * 0.6;
    const k = 1 + gully * 0.018 * (1 - t) * Math.min(1, t * 6);
    p.setX(i, x * k);
    p.setZ(i, z * k);
  }
  geometry.computeVertexNormals();
  const material = new T.ShaderMaterial({
    fog: false,
    uniforms: {
      sun: { value: new T.Vector3(-31, 33, 62).normalize() },
      haze: { value: new T.Color("#c8d9e6") },
      night: { value: 0 },
      flash: { value: 0 },
    },
    vertexShader: `
      varying vec3 vNormal; varying vec3 vLocal; varying float vDepth;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vLocal = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 sun; uniform vec3 haze; uniform float night; uniform float flash;
      varying vec3 vNormal; varying vec3 vLocal; varying float vDepth;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+1.),f.x),f.y); }
      void main() {
        float t = vLocal.y / ${PEAK.height.toFixed(1)};
        float a = atan(vLocal.z, vLocal.x);
        float streak = n(vec2(a * 18.0, t * 3.0)) * 0.6 + n(vec2(a * 61.0, t * 9.0)) * 0.4;
        float snowLine = 0.52 + (streak - 0.5) * 0.34;
        float snow = smoothstep(snowLine - 0.03, snowLine + 0.03, t);
        vec3 rock = mix(vec3(0.20, 0.25, 0.33), vec3(0.33, 0.38, 0.47), streak);
        vec3 albedo = mix(rock, vec3(0.80, 0.84, 0.92), snow);
        float diffuse = max(dot(normalize(vNormal), sun), 0.0);
        vec3 sky = vec3(0.55, 0.68, 0.86);
        vec3 lit = albedo * (sky * 0.5 + vec3(1.0, 0.88, 0.74) * diffuse * 0.75);
        // Aerial perspective: base dissolves into the valley haze, summit stays crisp.
        float air = clamp(0.78 - t * 0.62, 0.2, 0.78);
        vec3 color = mix(lit, haze, air);
        color = mix(color, color * vec3(0.16, 0.19, 0.3), night);
        color += vec3(0.55, 0.7, 1.0) * flash * (0.25 + snow * 0.6) * night;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const peak = new T.Mesh(geometry, material);
  peak.name = "Hero peak";
  peak.position.set(PEAK.x, -40, PEAK.z);
  peak.frustumCulled = false;
  return peak;
}

/** Five-storey vermilion pagoda with upturned eaves and a bronze spire. */
function createPagoda(T) {
  const group = new T.Group();
  group.name = "Valley pagoda";
  const vermilion = new T.MeshStandardMaterial({ color: "#b8382a", roughness: 0.62 });
  const plaster = new T.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.9 });
  const roofMat = new T.MeshStandardMaterial({ color: "#2b3433", roughness: 0.55, metalness: 0.15 });
  const bronze = new T.MeshStandardMaterial({ color: "#a4873e", roughness: 0.35, metalness: 0.8 });
  const stone = new T.MeshStandardMaterial({ color: "#8a8b80", roughness: 0.95 });
  const add = (geo, mat, y, s = 1) => {
    const m = new T.Mesh(geo, mat);
    m.position.y = y;
    m.scale.setScalar(s);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  // Square hipped roof: the lathe is squared off, sags concave, and flicks up at the corners.
  function roof(radius, rise) {
    const g = new T.CylinderGeometry(radius * 0.52, radius, rise, 64, 4, false);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), y = p.getY(i);
      const a = Math.atan2(z, x);
      const square = Math.min(1.35, 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))));
      const corner = Math.pow(Math.abs(Math.sin(2 * a)), 4);
      const low = 0.5 - y / rise; // 0 at the ridge, 1 at the eave
      p.setXYZ(i, x * square, y - low * low * rise * 0.28 + corner * low * low * rise * 0.6, z * square);
    }
    g.computeVertexNormals();
    return g;
  }
  add(new T.BoxGeometry(11, 1.2, 11), stone, 0.6);
  let y = 1.2;
  for (let level = 0; level < 5; level++) {
    const w = 6.4 - level * 0.72, h = 3.1 - level * 0.12;
    add(new T.BoxGeometry(w, h, w), plaster, y + h / 2);
    add(new T.BoxGeometry(w * 1.02, h * .42, w * 1.02), vermilion, y + h * .3);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = add(new T.BoxGeometry(0.42, h, 0.42), vermilion, y + h / 2);
      post.position.x = sx * (w / 2 - 0.1);
      post.position.z = sz * (w / 2 - 0.1);
    }
    const band = add(new T.BoxGeometry(w + 0.25, 0.42, w + 0.25), vermilion, y + h - 0.25);
    band.castShadow = false;
    add(roof(w * 0.86, 0.95), roofMat, y + h + 0.4);
    y += h + 0.9;
  }
  add(new T.CylinderGeometry(0.12, 0.16, 6.5, 8), bronze, y + 3.2);
  for (let i = 0; i < 9; i++) add(new T.TorusGeometry(0.42 - i * 0.025, 0.07, 6, 18), bronze, y + 0.9 + i * 0.52).rotation.x = Math.PI / 2;
  add(new T.SphereGeometry(0.32, 12, 8), bronze, y + 6.6);
  return group;
}

/** GPU-animated sakura petals that wrap around the camera. */
function createPetals(T, count) {
  const geometry = new T.InstancedBufferGeometry();
  const quad = new T.PlaneGeometry(0.075, 0.055);
  geometry.index = quad.index;
  geometry.attributes.position = quad.attributes.position;
  geometry.attributes.normal = quad.attributes.normal;
  geometry.attributes.uv = quad.attributes.uv;
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = Math.random();
    seeds[i * 4 + 1] = Math.random();
    seeds[i * 4 + 2] = Math.random();
    seeds[i * 4 + 3] = Math.random();
  }
  geometry.setAttribute("seed", new T.InstancedBufferAttribute(seeds, 4));
  geometry.instanceCount = count;
  const uniforms = {
    time: { value: 0 },
    focus: { value: new T.Vector3() },
    wind: { value: new T.Vector2(0.9, -0.35) },
  };
  const material = new T.MeshLambertMaterial({
    color: "#ffc4d3",
    emissive: "#d9708f",
    emissiveIntensity: 0.35,
    side: T.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec4 seed; uniform float time; uniform vec3 focus; uniform vec2 wind;
        varying float vPetalFade;
        mat3 petalSpin(vec3 a, float r){ a=normalize(a); float s=sin(r), c=cos(r), o=1.-c;
          return mat3(o*a.x*a.x+c, o*a.x*a.y+a.z*s, o*a.z*a.x-a.y*s,
                      o*a.x*a.y-a.z*s, o*a.y*a.y+c, o*a.y*a.z+a.x*s,
                      o*a.z*a.x+a.y*s, o*a.y*a.z-a.x*s, o*a.z*a.z+c); }`)
      .replace("#include <beginnormal_vertex>", `
        mat3 spin = petalSpin(vec3(seed.x - .5, 1., seed.y - .5), time * (1.2 + seed.z * 2.6) + seed.w * 6.28);
        vec3 objectNormal = spin * vec3(normal);`)
      .replace("#include <begin_vertex>", `
        vec3 box = vec3(46., 18., 46.);
        float fall = time * (0.55 + seed.z * 0.5);
        vec3 drift = vec3(wind.x, 0., wind.y) * time * (0.7 + seed.y * 0.6);
        drift.x += sin(time * 0.9 + seed.w * 20.) * 1.6;
        drift.z += cos(time * 0.7 + seed.x * 20.) * 1.2;
        vec3 origin = seed.xyz * box + drift - vec3(0., fall, 0.);
        vec3 local = mod(origin - focus + box * .5, box) - box * .5;
        vec3 center = focus + local;
        vPetalFade = 1. - smoothstep(.36, .5, max(abs(local.x)/box.x, abs(local.z)/box.z));
        vec3 transformed = center + spin * (position * (0.8 + seed.w * 0.6));`)
      .replace("#include <common>", "#include <common>");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPetalFade;")
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
        gl_FragColor.a *= vPetalFade * smoothstep(0.62, 0.35, length(vUv - .5));`)
      .replace("void main() {", "varying vec2 vUv;\nvoid main() {");
    shader.vertexShader = shader.vertexShader.replace("void main() {", "varying vec2 vUv;\nvoid main() {\n vUv = uv;");
  };
  const mesh = new T.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = "Sakura petal drift";
  mesh.renderOrder = 5;
  return { mesh, uniforms };
}

/** Wind-blown rain streaks for the Celestial Storm. */
function createRain(T, count) {
  const positions = new Float32Array(count * 6);
  const seeds = new Float32Array(count * 2 * 3);
  for (let i = 0; i < count; i++) {
    const x = Math.random(), y = Math.random(), z = Math.random();
    for (let v = 0; v < 2; v++) {
      seeds.set([x, y, z], (i * 2 + v) * 3);
      positions.set([0, v * 1, 0], (i * 2 + v) * 3);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new T.BufferAttribute(seeds, 3));
  const uniforms = { time: { value: 0 }, focus: { value: new T.Vector3() }, flash: { value: 0 } };
  const material = new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    uniforms,
    vertexShader: `
      attribute vec3 seed; uniform float time; uniform vec3 focus; varying float vTip;
      void main(){
        vec3 box = vec3(36., 22., 36.);
        vec3 o = seed * box - vec3(-2.5, 24., 1.4) * time * (0.9 + seed.y * 0.25);
        vec3 local = mod(o - focus + box * .5, box) - box * .5;
        vec3 p = focus + local + vec3(-0.1, 0.62, 0.05) * position.y;
        vTip = position.y;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `
      uniform float flash; varying float vTip;
      void main(){ gl_FragColor = vec4(vec3(0.55, 0.68, 0.9) * (0.5 + flash * 2.), vTip * (0.16 + flash * 0.25)); }`,
  });
  const lines = new T.LineSegments(geometry, material);
  lines.frustumCulled = false;
  lines.name = "Storm rain";
  return { lines, uniforms };
}

function glowTexture(T, inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const gradient = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.25, outer);
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gradient;
  g.fillRect(0, 0, 128, 128);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

function windGrass(T, scene, uniforms) {
  scene.traverse((object) => {
    if (!object.isInstancedMesh || object.material?.userData?.valleySurface !== "grass") return;
    const material = object.material;
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer);
      shader.uniforms.grassTime = uniforms.time;
      shader.uniforms.grassFocus = uniforms.focus;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float grassTime; uniform vec3 grassFocus;")
        .replace("#include <project_vertex>", `
          {
            vec3 root = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float sway = transformed.y * transformed.y * 4.0;
            float gust = sin(root.x * 0.21 + grassTime * 1.7) * 0.6 + sin(root.z * 0.13 + grassTime * 0.9 + root.x * 0.05) * 0.4;
            float flutter = sin(grassTime * 6.0 + root.x * 3.1 + root.z * 2.3) * 0.12;
            // The Watchkeeper parts the grass as they walk through it.
            vec3 away = root - grassFocus; away.y = 0.;
            float near = 1. - smoothstep(0.2, 1.1, length(away));
            vec3 offset = vec3((gust + flutter) * 0.32, 0., (gust * 0.4 + flutter) * 0.2) * sway;
            offset += normalize(away + vec3(0.0001)) * near * sway * 0.9;
            offset.y -= near * sway * 0.12;
            // Offsets are authored in world space; undo the blade's own yaw and scale.
            transformed += inverse(mat3(instanceMatrix)) * offset;
          }
          #include <project_vertex>`);
    };
    material.customProgramCacheKey = () => "wind-grass";
    material.needsUpdate = true;
  });
}

export function createPolish(T, { scene, camera, world, root }) {
  const peak = createPeak(T);
  scene.add(peak);

  const pagoda = createPagoda(T);
  const px = -30, pz = -98;
  pagoda.position.set(px, world.height(px, pz) - 0.4, pz);
  pagoda.rotation.y = 0.35;
  pagoda.scale.setScalar(1.25);
  scene.add(pagoda);

  const petals = createPetals(T, matchMedia("(max-width: 700px)").matches ? 500 : 1400);
  scene.add(petals.mesh);

  const rain = createRain(T, 4200);
  rain.lines.visible = false;
  scene.add(rain.lines);

  const grassUniforms = { time: { value: 0 }, focus: { value: new T.Vector3(0, -99, 0) } };
  windGrass(T, scene, grassUniforms);

  // Warm halos make restored lanterns read as light sources through the mist.
  const haloMaterial = new T.SpriteMaterial({
    map: glowTexture(T, "rgba(255,236,190,1)", "rgba(255,170,80,0.45)"),
    blending: T.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
  });
  const halos = world.lanterns.map((lantern) => {
    const sprite = new T.Sprite(haloMaterial.clone());
    sprite.position.set(lantern.x, world.height(lantern.x, lantern.z) + 1.85, lantern.z);
    sprite.scale.setScalar(3.2);
    sprite.material.opacity = 0;
    scene.add(sprite);
    // Embers that rise from the wick while it catches.
    const emberGeo = new T.BufferGeometry();
    const seeds = new Float32Array(36 * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    emberGeo.setAttribute("position", new T.BufferAttribute(seeds, 3));
    const embers = new T.Points(emberGeo, new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { life: { value: 0 }, time: { value: 0 } },
      vertexShader: `uniform float life; uniform float time; varying float vA;
        void main(){ vec3 s = position; float t = fract(s.y + time * (0.35 + s.x * 0.4));
          vec3 p = vec3((s.x - .5) * .5 + sin(t * 9. + s.z * 20.) * .12 * t, t * 2.4, (s.z - .5) * .5);
          vA = life * (1. - t) * smoothstep(0., .15, t);
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = (2.5 + s.z * 3.) * (40. / -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - .5);
          gl_FragColor = vec4(1., .72, .35, vA * smoothstep(.5, .1, d)); }`,
    }));
    embers.position.copy(sprite.position).y -= 0.2;
    embers.frustumCulled = false;
    embers.visible = false;
    scene.add(embers);
    return { sprite, lantern, embers, ignite: -1, wasLit: null };
  });

  // Storm lightning: one shadowless key light and a screen flash shared by sky and rain.
  const bolt = new T.DirectionalLight("#bcd4ff", 0);
  bolt.position.set(20, 60, -30);
  scene.add(bolt);

  const overlay = document.createElement("div");
  overlay.id = "feel-overlay";
  root.append(overlay);
  const letterbox = document.createElement("div");
  letterbox.id = "letterbox";
  root.append(letterbox);

  let shake = 0, timeScale = 1, hitStop = 0, flashValue = 0, nextBolt = 4, boltTime = -1, wasStorm = false;
  let tint = "255,255,255";
  const shakeOffset = new T.Vector3();

  function feel(events, reduced) {
    for (const e of events) {
      if (e.type === "enemyHit") {
        shake = Math.max(shake, e.attack && /heavy|charged|crush|launch|finisher|slam/i.test(e.attack) ? 0.22 : 0.11);
        hitStop = Math.max(hitStop, e.damage >= 25 ? 0.085 : 0.05);
      }
      if (e.type === "enemyDefeated") { shake = Math.max(shake, 0.3); hitStop = 0.14; flash(0.35, "255,226,170"); }
      if (e.type === "playerHit") { shake = Math.max(shake, 0.26); flash(0.45, "200,40,40"); }
      if (e.type === "parry") { hitStop = 0.16; shake = Math.max(shake, 0.16); flash(0.5, "255,248,225"); }
      if (e.type === "guardBreak") shake = Math.max(shake, 0.2);
    }
    if (reduced) { shake = 0; hitStop = 0; }
  }
  function flash(strength, color) {
    flashValue = Math.max(flashValue, strength);
    tint = color;
  }

  return {
    get timeScale() { return timeScale; },
    /** Call after camera placement, before rendering. */
    update(dt, time, { player, stormActive, events = [], reduced = false, cinematic = 0 }) {
      feel(events, reduced);
      hitStop = Math.max(0, hitStop - dt);
      timeScale = hitStop > 0 ? 0.12 : 1;

      grassUniforms.time.value = time;
      grassUniforms.focus.value.copy(player.position);
      petals.uniforms.time.value = time;
      petals.uniforms.focus.value.copy(camera.position);
      petals.mesh.visible = !stormActive;
      pagoda.visible = !stormActive;

      for (const halo of halos) {
        const { sprite, lantern, embers } = halo;
        const lit = (lantern.light?.intensity ?? 0) > 0;
        // Lanterns lit on load glow at once; a fresh restoration catches over ~2.5 s.
        if (halo.wasLit === null) halo.ignite = lit ? -99 : -1;
        else if (lit && !halo.wasLit) halo.ignite = time;
        halo.wasLit = lit;
        const age = halo.ignite === -99 ? 9 : time - halo.ignite;
        const catchUp = lit ? (reduced ? 1 : Math.min(1, age / 2.2) ** 1.6) : 0;
        const flicker = 0.85 + Math.sin(time * 11 + lantern.x) * 0.05 + Math.sin(time * 23.7 + lantern.z) * 0.04;
        const surge = lit && age < 2.6 && !reduced ? Math.sin(Math.min(1, age / 2.6) * Math.PI) * 0.6 : 0;
        const target = lit && !stormActive ? (0.75 * flicker + surge) * catchUp : 0;
        sprite.material.opacity += (target - sprite.material.opacity) * Math.min(1, dt * 5);
        sprite.scale.setScalar(3.2 + surge * 2.5);
        sprite.visible = sprite.material.opacity > 0.01;
        if (lit && lantern.light) lantern.light.intensity = Math.max(0.001, 2.4 * flicker * catchUp + surge * 3);
        const emberLife = lit && !stormActive && !reduced && age < 6 ? Math.min(1, age * 2) * (1 - Math.max(0, age - 3) / 3) : 0;
        embers.visible = emberLife > 0.01;
        embers.material.uniforms.life.value = emberLife;
        embers.material.uniforms.time.value = time;
      }

      // Storm weather: rain, periodic lightning and a darkened hero peak.
      if (stormActive !== wasStorm) { wasStorm = stormActive; nextBolt = time + 3; }
      rain.lines.visible = stormActive;
      peak.material.uniforms.night.value = stormActive ? 1 : 0;
      let boltLevel = 0;
      if (stormActive) {
        rain.uniforms.time.value = time;
        rain.uniforms.focus.value.copy(camera.position);
        if (!reduced && time >= nextBolt) { boltTime = time; nextBolt = time + 5 + Math.random() * 9; }
        const since = time - boltTime;
        if (boltTime >= 0 && since < 0.7) {
          // Double-strike envelope, the way real lightning re-strikes its channel.
          boltLevel = Math.exp(-since * 14) + (since > 0.16 ? Math.exp(-(since - 0.16) * 10) * 0.7 : 0);
        }
      }
      bolt.intensity = boltLevel * 5.5;
      rain.uniforms.flash.value = boltLevel;
      peak.material.uniforms.flash.value = boltLevel;

      flashValue = Math.max(0, flashValue - dt * 2.6);
      const sky = stormActive ? boltLevel * 0.22 : 0;
      overlay.style.background = flashValue > sky
        ? `radial-gradient(ellipse at center, rgba(${tint},${(flashValue * 0.25).toFixed(3)}) 0%, rgba(${tint},${(flashValue * 0.55).toFixed(3)}) 100%)`
        : sky > 0.005 ? `rgba(190,210,255,${sky.toFixed(3)})` : "transparent";
      letterbox.classList.toggle("on", cinematic > 0.5);

      // Trauma-style shake: squared falloff keeps light hits subtle.
      shake = Math.max(0, shake - dt * 1.8);
      const s = shake * shake * 1.6;
      if (s > 0.0001) {
        shakeOffset.set(
          Math.sin(time * 71.3) * s, Math.sin(time * 53.9 + 1.7) * s * 0.8, Math.sin(time * 61.1 + 3.1) * s * 0.5,
        );
        camera.position.add(shakeOffset);
      }
    },
  };
}
