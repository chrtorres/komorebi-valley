// Compound silhouettes keep the crowns legible when the individual leaves fall below a pixel.
function crownAtlas(T) {
  const patterns = [
    [[-.31, -.18, .05, .36, .11], [-.13, -.22, .49, .10, .124],
      [-.27, -.16, .02, -.45, .086], [-.03, -.07, .32, .44, .088]],
    [[-.43, -.26, .16, .39, .055], [-.24, -.1, .52, .09, .053],
      [-.11, -.071, .48, -.27, .051], [-.28, -.12, -.10, .44, .054],
      [.09, .13, .42, .38, .046]],
    [[-.31, -.14, .19, .33, .13], [-.13, -.14, .44, -.09, .109],
      [-.21, -.16, -.1, -.43, .092], [.05, .09, .40, .35, .10]],
  ];
  const size = 128;
  const pixels = new Uint8Array(size * size * patterns.length * 4);
  patterns.forEach((pattern, row) => {
    const blades = pattern.map(([x, y, tipX, tipY, width]) => {
      const dx = tipX - x, dy = tipY - y, length = Math.hypot(dx, dy);
      return { x, y, dx: dx / length, dy: dy / length, length, width };
    });
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = (i + .5) / size * 1.16 - .58;
        const y = (j + .5) / size * 1.10 - .55;
        let alpha = 0, shade = 235;
        for (const blade of blades) {
          const px = x - blade.x, py = y - blade.y;
          const along = (px * blade.dx + py * blade.dy) / blade.length;
          if (along < 0 || along > 1) continue;
          const across = Math.abs(px * blade.dy - py * blade.dx);
          const teeth = row === 0 ? 1 + .18 * Math.cos(along * 73) : 1;
          const width = blade.width * Math.sin(Math.PI * along) ** .82 * teeth;
          const coverage = T.MathUtils.smoothstep(width - across, -.008, .009);
          if (coverage <= alpha) continue;
          alpha = coverage;
          shade = 221 + 25 * along + 8 * (1 - T.MathUtils.smoothstep(across, 0, .013));
        }
        const index = ((row * size + j) * size + i) * 4;
        pixels[index] = Math.min(255, shade + 3);
        pixels[index + 1] = shade;
        pixels[index + 2] = Math.max(0, shade - 7);
        pixels[index + 3] = Math.round(255 * alpha);
      }
    }
  });
  const texture = new T.DataTexture(pixels, size, size * patterns.length, T.RGBAFormat);
  texture.colorSpace = T.SRGBColorSpace;
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createLeafCards(T, capacity) {
  const geometry = new T.PlaneGeometry(.80, .58);
  geometry.setAttribute("leafRow", new T.InstancedBufferAttribute(new Float32Array(capacity), 1));
  const material = new T.MeshStandardMaterial({
    map: crownAtlas(T),
    alphaTest: .27,
    alphaToCoverage: true,
    side: T.DoubleSide,
    roughness: .92,
    dithering: true,
  });
  material.userData.valleySurface = "foliage";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float leafRow;")
      .replace("#include <uv_vertex>", `
        #include <uv_vertex>
        vMapUv.y = (vMapUv.y + leafRow) / 3.0;
      `);
  };
  const mesh = new T.InstancedMesh(geometry, material, capacity);
  mesh.name = "Veiled Pass crowns";
  return mesh;
}

export function createGrassGeometry(T) {
  const positions = [], colors = [], indices = [];
  const root = new T.Color("#3b4e2f"), fold = new T.Color("#86a463"), tip = new T.Color("#c9d98e");
  // Bent, tapering blades catch light higher up and shade the roots into the terrain.
  for (const [angle, height, bend, width] of [[.35, .32, .16, .032], [2.43, .22, .19, .029], [4.45, .29, .15, .027]]) {
    const x = Math.cos(angle), z = Math.sin(angle), start = positions.length / 3;
    positions.push(
      -z * width, 0, x * width,
      z * width, 0, -x * width,
      x * bend * .34 - z * width * .57, height * .56, z * bend * .34 + x * width * .57,
      x * bend * .34 + z * width * .57, height * .56, z * bend * .34 - x * width * .57,
      x * bend, height, z * bend,
    );
    for (const color of [root, root, fold, fold, tip]) colors.push(color.r, color.g, color.b);
    indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2, start + 2, start + 3, start + 4);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
