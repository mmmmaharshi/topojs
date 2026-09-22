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

// ── Terrain heightmap (fractal Brownian motion) ──
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
