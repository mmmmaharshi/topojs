/**
 * Procedural dataset generators for TopoJS examples and benchmarks.
 *
 * All functions use a deterministic seeded PRNG — no embedded data.
 */

// ── Helper: simple seeded random ──
let _seed = 42;
function seededRandom(): number {
  _seed = (_seed * 16_807) % 2_147_483_647;
  return (_seed - 1) / 2_147_483_646;
}

function resetSeed(s = 42) {
  _seed = s;
}

function gaussian(): number {
  const u1 = seededRandom();
  const u2 = seededRandom();
  return Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
}

// ── 1. Terrain heightmap (fractal Brownian motion) ──
/** Procedural fractal-Brownian-motion terrain heightmap, `size x size` values flattened row-major -- deterministic (seeded internally), for synthetic-but-structured cubical-complex examples. Higher `octaves` adds finer detail layers. */
export function generateTerrain(size = 64, octaves = 6): Float64Array {
  const data = new Float64Array(size * size);

  function noise2D(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const v00 = seededRandom();
    const v10 = seededRandom();
    const v01 = seededRandom();
    const v11 = seededRandom();
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const top = v00 + (v10 - v00) * sx;
    const bot = v01 + (v11 - v01) * sx;
    return top + (bot - top) * sy;
  }

  resetSeed(42);
  let amplitude = 1;
  let frequency = 4;
  let maxVal = 0;

  for (let oct = 0; oct < octaves; oct++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = (x / size) * frequency;
        const ny = (y / size) * frequency;
        data[y * size + x] =
          (data[y * size + x] ?? 0) + noise2D(nx, ny) * amplitude;
      }
    }
    maxVal += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }

  for (let i = 0; i < data.length; i++) {
    data[i] = ((data[i] ?? 0) / maxVal) * 255;
  }

  return data;
}

// ── 4. Torus point cloud (simulating a 3D scan) ──
export function generateTorus3D(
  n = 300,
  R = 2,
  r = 1,
  noise = 0.05
): Float64Array {
  const pts = new Float64Array(n * 3);
  resetSeed(99);
  for (let i = 0; i < n; i++) {
    const theta = 2 * Math.PI * seededRandom();
    const phi = 2 * Math.PI * seededRandom();
    const x = (R + r * Math.cos(theta)) * Math.cos(phi) + gaussian() * noise;
    const y = (R + r * Math.cos(theta)) * Math.sin(phi) + gaussian() * noise;
    const z = r * Math.sin(theta) + gaussian() * noise;
    pts[i * 3] = x;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = z;
  }
  return pts;
}

// ── 5. Sphere point cloud (simulating a 3D scan) ──
export function generateSphere3D(
  n = 300,
  radius = 1,
  noise = 0.03
): Float64Array {
  const pts = new Float64Array(n * 3);
  resetSeed(77);
  for (let i = 0; i < n; i++) {
    const theta = 2 * Math.PI * seededRandom();
    const phi = Math.acos(2 * seededRandom() - 1);
    const x = radius * Math.sin(phi) * Math.cos(theta) + gaussian() * noise;
    const y = radius * Math.sin(phi) * Math.sin(theta) + gaussian() * noise;
    const z = radius * Math.cos(phi) + gaussian() * noise;
    pts[i * 3] = x;
    pts[i * 3 + 1] = y;
    pts[i * 3 + 2] = z;
  }
  return pts;
}

// ── 6. Natural image for cubical persistence ──
export function generateNaturalImage(size = 64): Float64Array {
  const img = new Float64Array(size * size);
  resetSeed(123);

  for (let y = 0; y < size / 3; y++) {
    for (let x = 0; x < size; x++) {
      const brightness = 200 - y * (80 / (size / 3));
      const cloud = (seededRandom() - 0.5) * 30;
      const v = Math.max(0, Math.min(255, brightness + cloud));
      img[y * size + x] = v;
    }
  }

  const ridge: number[] = [];
  for (let x = 0; x < size; x++) {
    ridge.push(size / 3 + seededRandom() * (size / 3));
  }

  for (let y = Math.floor(size / 3); y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ridgeY = ridge[x] ?? size / 2;
      if (y < ridgeY) {
        const dist = (ridgeY - y) / (size / 3);
        const v = 200 - 30 * dist + (seededRandom() - 0.5) * 10;
        img[y * size + x] = Math.max(0, Math.min(255, v));
      } else {
        const dist = (y - ridgeY) / (size * 0.6);
        const brightness = 60 + 40 * (1 - dist) + (seededRandom() - 0.5) * 15;
        const texture =
          Math.sin(x * 0.5 + y * 0.3) * 8 + Math.sin(x * 1.2 + y * 0.7) * 5;
        img[y * size + x] = Math.max(0, Math.min(255, brightness + texture));
      }
    }
  }

  return img;
}

// ── 7. Image patches (3×3 patches from natural image) ──
export function extractImagePatches(
  image: Float64Array,
  size: number,
  threshold = 30
): Float64Array {
  const patches: number[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const center = image[y * size + x]!;
      let contrast = 0;
      const patch: number[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = image[(y + dy) * size + (x + dx)]!;
          patch.push(v);
          contrast += Math.abs(v - center);
        }
      }
      if (contrast >= threshold) {
        for (const p of patch) {
          patches.push(p);
        }
      }
    }
  }
  return new Float64Array(patches);
}

// ── 8. Coastline / river meander (2D curve) ──
export function generateCoastline(n = 200): Float64Array {
  const pts = new Float64Array(n * 2);
  resetSeed(55);
  let x = 0,
    y = 0;
  for (let i = 0; i < n; i++) {
    x += seededRandom() * 0.3 + 0.2;
    y += Math.sin(x * 2) * 0.3 + (seededRandom() - 0.5) * 0.2;
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
  }
  return pts;
}
