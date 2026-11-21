// The warning uses the campaign's visible ground surface, including its cobbles.
export const stormGroundSurfaces = new WeakMap();

function lattice(x, y) {
  const h = Math.imul(x + 37, 374761393) ^ Math.imul(y + 71, 668265263);
  return ((Math.imul(h ^ (h >>> 13), 1274126177) >>> 0) & 0xffff) / 0xffff;
}

function noise(u, v, columns, rows = columns) {
  const x = u * columns, y = v * rows;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const left = ix % columns, right = (ix + 1) % columns;
  const bottom = iy % rows, top = (iy + 1) % rows;
  const a = lattice(left, bottom) * (1 - sx) + lattice(right, bottom) * sx;
  const b = lattice(left, top) * (1 - sx) + lattice(right, top) * sx;
  return a * (1 - sy) + b * sy;
}

function texture(T, pixels, size, colorSpace = T.NoColorSpace) {
  const map = new T.DataTexture(pixels, size, size);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.minFilter = T.LinearMipmapLinearFilter;
  map.magFilter = T.LinearFilter;
  map.generateMipmaps = true;
  map.colorSpace = colorSpace;
  map.needsUpdate = true;
  return map;
}

export function createStormSurfaceMaps(T, cedar = false) {
  const size = 128;
  const height = new Float32Array(size * size);
  const color = new Uint8Array(height.length * 4);
  const roughness = new Uint8Array(color.length);
  const normal = new Uint8Array(color.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = y * size + x, offset = i * 4;
      const broad = noise(u, v, 5), grain = noise(u, v, 48, cedar ? 4 : 48);
      const flecks = lattice(x, y);
      const frost = cedar ? 0 : T.MathUtils.smoothstep(broad + grain * 0.16, 0.64, 0.86);
      const shade = cedar ? 0.66 + broad * 0.14 + grain * 0.2 : 0.69 + broad * 0.22 + grain * 0.1;
      height[i] = (cedar ? 0.36 : 0.61) * grain + 0.26 * broad + 0.055 * flecks;
      color[offset] = 255 * Math.min(1, shade + frost * 0.04);
      color[offset + 1] = 255 * Math.min(1, shade + frost * 0.13);
      color[offset + 2] = 255 * Math.min(1, shade + frost * 0.22);
      color[offset + 3] = 255;
      const porous = 0.35 + (1 - broad) * 0.36 + grain * 0.11;
      const rough = 255 * (porous * (1 - frost) + (0.84 + flecks * 0.13) * frost);
      roughness.set([rough, rough, rough, 255], offset);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = height[y * size + (x + size - 1) % size] - height[y * size + (x + 1) % size];
      const ny = height[((y + size - 1) % size) * size + x] - height[((y + 1) % size) * size + x];
      const length = Math.hypot(nx, ny, 1);
      normal.set([128 + 127 * nx / length, 128 + 127 * ny / length, 128 + 127 / length, 255], (y * size + x) * 4);
    }
  }
  return {
    map: texture(T, color, size, T.SRGBColorSpace),
    roughnessMap: texture(T, roughness, size),
    normalMap: texture(T, normal, size),
  };
}

export function createStormCloudMap(T) {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const density = 255 * (0.57 * noise(u, v, 8) + 0.29 * noise(u, v, 17) + 0.14 * noise(u, v, 39));
      pixels.set([density, density, density, 255], (y * size + x) * 4);
    }
  }
  return texture(T, pixels, size);
}

export function roundedStormBox(T, bevel = 0.08) {
  const geometry = new T.BoxGeometry(1, 1, 1, 4, 4, 4);
  const positions = geometry.attributes.position, normals = geometry.attributes.normal;
  const inset = 0.5 - bevel;
  const edge = (n) => Math.abs(n) === 0.25 ? Math.sign(n) * inset : n;
  for (let i = 0; i < positions.count; i++) {
    const x = edge(positions.getX(i)), y = edge(positions.getY(i)), z = edge(positions.getZ(i));
    const a = T.MathUtils.clamp(x, -inset, inset), b = T.MathUtils.clamp(y, -inset, inset);
    const c = T.MathUtils.clamp(z, -inset, inset);
    const length = Math.hypot(x - a, y - b, z - c);
    const nx = (x - a) / length, ny = (y - b) / length, nz = (z - c) / length;
    positions.setXYZ(i, a + nx * bevel, b + ny * bevel, c + nz * bevel);
    normals.setXYZ(i, nx, ny, nz);
    const uv = geometry.attributes.uv;
    uv.setXY(i, edge(uv.getX(i) - 0.5) + 0.5, edge(uv.getY(i) - 0.5) + 0.5);
  }
  return geometry;
}
