import type { PersistencePair } from "../core/h0.ts";

export interface PersistenceLandscapeOptions {
  maxLandscape?: number;
  resolution?: number;
  maxFiltration?: number;
}

export interface PersistenceImageOptions {
  resolution?: [number, number];
  variance?: number;
  weightFunction?: "linear" | "none";
  maxFiltration?: number;
}

function tentValue(birth: number, death: number, t: number): number {
  if (death < 0) {
    return t > birth ? t - birth : 0;
  }
  if (t <= birth || t >= death) {
    return 0;
  }
  const mid = (birth + death) / 2;
  return t <= mid ? t - birth : death - t;
}

export function computePersistenceLandscape(
  pairs: PersistencePair[],
  options?: PersistenceLandscapeOptions
): number[][] {
  const maxLandscape = options?.maxLandscape ?? 5;
  const resolution = options?.resolution ?? 100;

  let maxFiltration = options?.maxFiltration;
  if (maxFiltration === undefined) {
    maxFiltration = 0;
    for (const p of pairs) {
      if (p.death > maxFiltration) {
        maxFiltration = p.death;
      }
      if (p.birth > maxFiltration && p.death < 0) {
        maxFiltration = p.birth;
      }
    }
    if (maxFiltration <= 0) {
      maxFiltration = 1;
    }
  }

  const step = maxFiltration / (resolution - 1);
  const grid = new Float64Array(resolution);
  for (let i = 0; i < resolution; i++) {
    grid[i] = i * step;
  }

  const landscape: number[][] = [];
  for (let k = 0; k < maxLandscape; k++) {
    landscape.push(Array.from({ length: resolution }, () => 0));
  }

  const tentVals = new Float64Array(pairs.length);
  for (let i = 0; i < resolution; i++) {
    const t = grid[i]!;
    for (let j = 0; j < pairs.length; j++) {
      tentVals[j] = tentValue(pairs[j]!.birth, pairs[j]!.death, t);
    }
    tentVals.sort((a, b) => b - a);
    for (let k = 0; k < maxLandscape && k < tentVals.length; k++) {
      landscape[k]![i] = tentVals[k]!;
    }
  }

  return landscape;
}

function gaussian(x: number, mean: number, variance: number): number {
  const d = x - mean;
  return Math.exp((-d * d) / (2 * variance));
}

export function computePersistenceImage(
  pairs: PersistencePair[],
  options?: PersistenceImageOptions
): number[][] {
  const resolution = options?.resolution ?? [50, 50];
  const variance = options?.variance ?? 0.1;
  const weightFunction = options?.weightFunction ?? "linear";

  const finite = pairs.filter((p) => p.death >= 0);
  if (finite.length === 0) {
    return Array.from({ length: resolution[1] }, () =>
      Array.from({ length: resolution[0] }, () => 0)
    );
  }

  let maxPersistence = 0;
  let maxFiltration = options?.maxFiltration;
  if (maxFiltration === undefined) {
    maxFiltration = 0;
    for (const p of finite) {
      const pers = p.death - p.birth;
      if (pers > maxPersistence) {
        maxPersistence = pers;
      }
      if (p.death > maxFiltration) {
        maxFiltration = p.death;
      }
    }
    if (maxFiltration <= 0) {
      maxFiltration = 1;
    }
  }

  const maxY = maxFiltration;
  const maxX = maxFiltration;
  const stepX = maxX / (resolution[0] - 1);
  const stepY = maxY / (resolution[1] - 1);

  const image: number[][] = [];
  for (let yi = 0; yi < resolution[1]; yi++) {
    image.push(Array.from({ length: resolution[0] }, () => 0));
  }

  const n = finite.length;
  const gaussX = new Float64Array(resolution[0]);
  for (let pi = 0; pi < n; pi++) {
    const p = finite[pi]!;
    const pers = p.death - p.birth;
    const x0 = p.birth;
    const y0 = pers;

    let weight = 1;
    if (weightFunction === "linear") {
      weight = pers;
    }
    if (weight <= 0) {
      continue;
    }

    for (let xi = 0; xi < resolution[0]; xi++) {
      gaussX[xi] = gaussian(xi * stepX, x0, variance);
    }

    for (let yi = 0; yi < resolution[1]; yi++) {
      const gy = gaussian(yi * stepY, y0, variance);
      if (gy < 1e-10) {
        continue;
      }
      const row = image[yi]!;
      for (let xi = 0; xi < resolution[0]; xi++) {
        row[xi]! += weight * gy * gaussX[xi]!;
      }
    }
  }

  return image;
}
