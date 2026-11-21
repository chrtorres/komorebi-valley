import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { DT, WIDTH, HEIGHT, floorAt, Pond, shore } from "./physics.js";

export const POND_X = -15;
export const POND_Z = -8;
const SCALE = 1.55;
const TAU = Math.PI * 2;

export const pondRadius = (x, z) => shore((x - POND_X) / SCALE, (z - POND_Z) / SCALE);

export function pondHeight(x, z, base, waterline) {
  const px = (x - POND_X) / SCALE;
  const pz = (z - POND_Z) / SCALE;
  const r = shore(px, pz);
  if (r >= 1.24) return base;
  const basin = waterline + SCALE * floorAt(px, pz);
  const t = Math.min(1, Math.max(0, (r - 1.015) / 0.225));
  return basin + (base - basin) * t * t * (3 - 2 * t);
}

function waterSurface(T, waves, time) {
  const geometry = new T.PlaneGeometry(WIDTH, HEIGHT);
  geometry.rotateX(-Math.PI / 2);
  return new T.Mesh(geometry, new T.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    uniforms: {
      ...T.UniformsUtils.clone(T.UniformsLib.fog),
      waves: { value: waves },
      pondTime: { value: time },
      stormLight: { value: 0 },
    },
    vertexShader: `
      varying vec3 waterPoint;
      varying vec2 pondPoint;
      #include <fog_pars_vertex>
      void main() {
        pondPoint = position.xz;
        waterPoint = (modelMatrix * vec4(position, 1.)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform sampler2D waves;
      uniform float pondTime;
      uniform float stormLight;
      varying vec3 waterPoint;
      varying vec2 pondPoint;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = pondPoint;
        float r = length(p / vec2(4.35,3.43));
        if (r > 1.03) discard;
        vec2 slope = (texture2D(waves,p/vec2(9.6,7.6)+.5).rg-128./255.)*3.25;
        float a = p.x*13.6+p.y*8.1+pondTime*1.12;
        float b = p.x*7.3-p.y*16.1+pondTime*.84;
        vec3 n = normalize(vec3(-slope.x-.026*cos(a)-.016*cos(b),1.,-slope.y-.019*cos(a)+.025*cos(b)));
        vec3 v = normalize(cameraPosition-waterPoint);
        if (v.y < 0.) n = -n;
        float fresnel = pow(1.-clamp(dot(n,v),0.,1.),4.);
        vec3 ray = reflect(-v,n);
        float sun = pow(max(0.,dot(ray,normalize(vec3(-35.,55.,-42.)))),86.);
        vec2 silhouette = ray.xz / max(.13, .27 + ray.y);
        float canopy = sin(silhouette.x*12.+cos(silhouette.y*13.))*sin(silhouette.y*19.+ray.y*14.);
        vec3 horizon = mix(vec3(.58,.39,.23),vec3(.43,.22,.28),stormLight);
        vec3 zenith = mix(vec3(.24,.39,.48),vec3(.10,.21,.31),stormLight);
        vec3 sky = mix(horizon,zenith,smoothstep(.03,.69,ray.y));
        float trees = (1. - smoothstep(.14,.48,ray.y)) * smoothstep(-.12,.46,canopy);
        sky = mix(sky,vec3(.031,.062,.044),trees*.86);
        vec3 rgb = mix(vec3(.032,.109,.086),sky,.22+fresnel*.72);
        rgb += sun*mix(vec3(1.4,1.06,.68),vec3(.46,.27,.33),stormLight);
        rgb += min(length(slope)*1.35,.22)*vec3(.50,.73,.63);
        float opacity = min(.87,.19+fresnel*.59+sun*.22+length(slope)*.24);
        gl_FragColor = vec4(rgb,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  }));
}

function addShore(T, habitat, elevation) {
  let seed = 9383;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const localFloor = (x, z) =>
    (elevation(POND_X + x * SCALE, POND_Z + z * SCALE) - habitat.position.y) /
    SCALE;
  const dummy = new T.Object3D();
  const pigment = new T.Color();
  const rockSource = new T.IcosahedronGeometry(1, 3);
  rockSource.deleteAttribute("uv");
  rockSource.deleteAttribute("normal");
  const stone = mergeVertices(rockSource);
  rockSource.dispose();
  const vertices = stone.attributes.position;
  const mineral = [];
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const weathering = 1 + 0.13 * Math.sin(x * 11 + y * 3) * Math.cos(z * 7 + y * 6);
    vertices.setXYZ(i, weathering * x, weathering * y, weathering * z);
    const vein = .68 + .18 * Math.sin(y * 19 + Math.cos(x * 13 + z * 4));
    const moss = Math.max(0, y) * (.55 + .45 * Math.sin(x * 8 + z * 6));
    mineral.push(vein - moss * .13, vein + moss * .05, vein - moss * .23);
  }
  stone.setAttribute("color", new T.Float32BufferAttribute(mineral, 3));
  stone.computeVertexNormals();
  const material = new T.MeshStandardMaterial({ roughness: 0.93, vertexColors: true });
  const gravel = new T.IcosahedronGeometry(1, 1);
  const grit = new Float32Array(gravel.attributes.position.count * 3).fill(.70);
  gravel.setAttribute("color", new T.BufferAttribute(grit, 3));
  const banks = new T.InstancedMesh(stone, material, 28);
  const bed = new T.InstancedMesh(gravel, material, 118);
  banks.name = "Weathered pond bank stones";
  bed.name = "Submerged gravel";
  banks.receiveShadow = bed.receiveShadow = true;
  for (let i = 0; i < banks.count + bed.count; i++) {
    const angle = random() * TAU;
    const bank = i < banks.count;
    const rocks = bank ? banks : bed;
    const index = bank ? i : i - banks.count;
    const r = bank ? 0.94 + random() * 0.19 : 0.91 * Math.sqrt(random());
    const x = r * 4.35 * Math.cos(angle);
    const z = r * 3.43 * Math.sin(angle);
    const size = bank ? 0.16 + 0.42 * random() ** 2 : 0.023 + 0.12 * random() ** 3;
    dummy.position.set(x, localFloor(x, z), z);
    dummy.rotation.set(random() * 0.36, angle, random() * 0.32);
    dummy.scale.set(size * 1.4, size * 0.55, size);
    dummy.updateMatrix();
    rocks.setMatrixAt(index, dummy.matrix);
    rocks.setColorAt(index, pigment.setHSL(.17 + random() * .10, .10 + random() * .15,
      (bank ? .28 : .20) + random() * .17));
  }
  habitat.add(banks, bed);

  const stems = [];
  const blade = new T.PlaneGeometry(1, 1, 2, 7);
  const v = blade.attributes.position;
  for (let i = 0; i < v.count; i++) {
    const h = v.getY(i) + 0.5;
    const x = v.getX(i) * (0.04 + 0.96 * Math.sin(Math.PI * h ** .8));
    v.setXYZ(i, x, h, h * h * .52 + Math.sin(Math.PI * h) * x * .22);
  }
  blade.computeVertexNormals();
  const reeds = new T.InstancedMesh(blade, new T.MeshStandardMaterial({
    roughness: .86, side: T.DoubleSide,
  }), 18 * 8);
  reeds.name = "Sedges and submerged ribbon plants";
  reeds.receiveShadow = true;
  for (let i = 0; i < 18; i++) {
    const angle = i * 2.39996 + random() * .25;
    const aquatic = i >= 10;
    const radius = aquatic ? .60 + random() * .16 : .96 + random() * .09;
    const x = 4.35 * radius * Math.cos(angle);
    const z = 3.43 * radius * Math.sin(angle);
    for (let j = 0; j < 8; j++) {
      const turn = j * TAU / 8 + random() * .35;
      stems.push({
        x: x + Math.sin(turn) * .07, z: z + Math.cos(turn) * .07,
        y: localFloor(x, z) - .028, turn,
        height: (aquatic ? .20 : .37) + random() * .29,
        width: aquatic ? .046 + random() * .033 : .024 + random() * .029,
      });
      reeds.setColorAt(i * 8 + j, pigment.setHSL(
        aquatic ? .24 + random() * .065 : .20 + random() * .057,
        .33 + random() * .22, .21 + random() * .16,
      ));
    }
  }
  habitat.add(reeds);
  const plantFlow = (time, pond) => {
    stems.forEach(({ x, y, z, turn, height, width }, i) => {
      const wind = Math.sin(time * 1.34 + x * 1.7 + z * 2.8) * .075;
      const [u, v] = pond.flow(x, y + height * .52, z);
      dummy.position.set(x, y, z);
      dummy.rotation.set(.11 + wind + v * .95, turn, u * .95);
      dummy.scale.set(width, height, height * .76);
      dummy.updateMatrix();
      reeds.setMatrixAt(i, dummy.matrix);
    });
    reeds.instanceMatrix.needsUpdate = true;
  };

  // A notch and raised rim keep the floating leaves legible from the walking camera.
  const padShape = new T.Shape();
  padShape.moveTo(0, 0);
  for (let i = 0; i <= 22; i++) {
    const angle = .20 + i / 22 * (TAU - .45);
    const r = 1 + Math.sin(angle * 7) * .04;
    padShape.lineTo(r * Math.cos(angle), r * Math.sin(angle));
  }
  padShape.closePath();
  const padGeometry = new T.ShapeGeometry(padShape);
  padGeometry.rotateX(-Math.PI / 2);
  const pads = new T.InstancedMesh(padGeometry, new T.MeshPhysicalMaterial({
    roughness: .61, clearcoat: .30, side: T.DoubleSide,
  }), 15);
  pads.name = "Floating pond leaves";
  for (let i = 0; i < pads.count; i++) {
    const angle = -.05 + (i % 2 ? .85 : 4.65) + (random() - .5) * .86;
    const r = .62 + random() * .23;
    const size = .10 + random() * .15;
    dummy.position.set(Math.cos(angle) * 4.35 * r, .014 + i * .0008,
      Math.sin(angle) * 3.43 * r);
    dummy.rotation.set(.035, random() * TAU, .045);
    dummy.scale.set(size, size, size * .9);
    dummy.updateMatrix();
    pads.setMatrixAt(i, dummy.matrix);
    pads.setColorAt(i, pigment.setHSL(.22 + random() * .07, .44, .25 + random() * .13));
  }
  habitat.add(pads);
  return plantFlow;
}

export function createKoiHabitat(T, scene, waterline, elevation) {
  const habitat = new T.Group();
  habitat.name = "Kōhaku pond";
  habitat.position.set(POND_X, waterline, POND_Z);
  habitat.scale.setScalar(SCALE);
  scene.add(habitat);
  const pond = new Pond();
  pond.select("surface");
  const field = pond.field;
  const waves = new T.DataTexture(field.encode(), field.size, field.size);
  waves.magFilter = T.LinearFilter;
  waves.minFilter = T.LinearFilter;
  waves.needsUpdate = true;
  const water = waterSurface(T, waves, 0);
  water.name = "Reflective pond surface";
  // The opaque fish and plants are drawn first, then tinted by the translucent surface.
  water.renderOrder = 2;
  habitat.add(water);
  const sway = addShore(T, habitat, elevation);
  sway(0, pond);

  let rig, status = "idle", attempts = 0, entered = false;
  let accumulator = 0, lastContact = -1, shoreRipples = 0;
  const previousFoot = new T.Vector2(Infinity, Infinity);
  const foot = new T.Vector2();
  function load() {
    status = "loading";
    attempts++;
    void import("./model.js")
      .then(({ loadKoiRig }) => loadKoiRig())
      .then((loaded) => {
        loaded.object.name = "Kōhaku koi";
        loaded.update(pond.sample());
        habitat.add(loaded.object);
        rig = loaded;
        status = "ready";
      })
      .catch(() => {
        status = "unavailable";
      });
  }
  return {
    object: habitat,
    get state() {
      return { status, shoreRipples, ...pond.sample(), ...field.metrics() };
    },
    update(dt, playerPosition, cameraPosition, reducedMotion, storm) {
      water.material.uniforms.stormLight.value = storm ? 1 : 0;
      const distance = cameraPosition.distanceToSquared(habitat.position);
      const nearby = distance < 32 ** 2;
      if (distance > 36 ** 2) entered = false;
      // Retry once on return to the pond after a transient download or decode failure.
      if (nearby && !entered && status !== "loading" && status !== "ready" && attempts < 2) {
        entered = true;
        load();
      }
      if (rig) rig.object.visible = nearby;
      // Distant scenery and reduced-motion mode retain their last complete pose.
      if (!nearby || reducedMotion) return;
      accumulator += Math.min(dt, .05);
      if (accumulator < DT) return;
      if (playerPosition) {
        foot.set((playerPosition.x - POND_X) / SCALE, (playerPosition.z - POND_Z) / SCALE);
        const r = shore(foot.x, foot.y);
        const footDepth = waterline - playerPosition.y;
        if (footDepth >= -.05 && footDepth < .60 && r < .975 &&
            pond.time - lastContact > .44 && foot.distanceToSquared(previousFoot) > .075) {
          pond.disturb(foot.x, foot.y);
          previousFoot.copy(foot);
          lastContact = pond.time;
          shoreRipples++;
        } else if (r >= .975 || footDepth < -.05) {
          previousFoot.set(Infinity, Infinity);
        }
      }
      while (accumulator >= DT) {
        const cycle = pond.time % 36;
        pond.select(cycle < 18 ? "surface" : cycle < 26 ? "cruise" : cycle < 32 ? "forage" : "burst");
        pond.step();
        accumulator -= DT;
      }
      rig?.update(pond.sample());
      water.material.uniforms.pondTime.value = pond.time;
      field.encode();
      waves.needsUpdate = true;
      sway(pond.time, pond);
    },
  };
}
