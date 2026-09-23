export interface ReferencePair {
  birth: number;
  death: number;
  dim: number;
}

interface Simplex {
  vertices: number[];
  value: number;
}

interface ReferenceColumn {
  faces: number[];
  value: number;
}

function squaredDistance(
  points: Float64Array,
  dims: number,
  first: number,
  second: number
): number {
  const firstBase = first * dims;
  const secondBase = second * dims;
  let squared = 0;
  for (let dimension = 0; dimension < dims; dimension++) {
    const difference =
      points[firstBase + dimension]! - points[secondBase + dimension]!;
    squared += difference * difference;
  }
  return squared;
}

function computeRadiusCap(
  points: Float64Array,
  dims: number,
  n: number
): number {
  if (n <= 1) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  for (let center = 0; center < n; center++) {
    let worst = 0;
    for (let vertex = 0; vertex < n; vertex++) {
      if (center !== vertex) {
        worst = Math.max(
          worst,
          Math.sqrt(squaredDistance(points, dims, center, vertex))
        );
      }
    }
    best = Math.min(best, worst);
  }
  return best;
}

function collectCombinations(
  n: number,
  size: number,
  start: number,
  current: number[],
  output: number[][]
): void {
  if (current.length === size) {
    output.push([...current]);
    return;
  }
  const remaining = size - current.length;
  for (let vertex = start; vertex <= n - remaining; vertex++) {
    current.push(vertex);
    collectCombinations(n, size, vertex + 1, current, output);
    current.pop();
  }
}

function simplexKey(vertices: number[]): string {
  return vertices.join(",");
}

function compareVertices(first: number[], second: number[]): number {
  for (let index = 0; index < first.length; index++) {
    const difference = first[index]! - second[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function sortSimplices(simplices: Simplex[]): void {
  simplices.sort(
    (first, second) =>
      first.value - second.value ||
      compareVertices(first.vertices, second.vertices)
  );
}

function canonicalReferencePairs(pairs: ReferencePair[]): ReferencePair[] {
  return pairs.toSorted(
    (first, second) =>
      first.dim - second.dim ||
      first.birth - second.birth ||
      first.death - second.death
  );
}

function findRoot(parents: Int32Array, vertex: number): number {
  let root = vertex;
  while (parents[root] !== root) {
    root = parents[root]!;
  }
  let current = vertex;
  while (parents[current] !== current) {
    const next = parents[current]!;
    parents[current] = root;
    current = next;
  }
  return root;
}

function h0Reference(
  n: number,
  edges: Simplex[]
): { pairs: ReferencePair[]; cycleEdges: boolean[] } {
  const parents = Int32Array.from({ length: n }, (_, index) => index);
  const sizes = new Int32Array(n).fill(1);
  const pairs: ReferencePair[] = [];
  const cycleEdges = Array.from({ length: edges.length }, () => false);
  for (let index = 0; index < edges.length; index++) {
    const [first, second] = edges[index]!.vertices as [number, number];
    const firstRoot = findRoot(parents, first);
    const secondRoot = findRoot(parents, second);
    if (firstRoot === secondRoot) {
      cycleEdges[index] = true;
      continue;
    }
    if (sizes[firstRoot] < sizes[secondRoot]) {
      parents[firstRoot] = secondRoot;
      sizes[secondRoot] += sizes[firstRoot];
    } else {
      parents[secondRoot] = firstRoot;
      sizes[firstRoot] += sizes[secondRoot];
    }
    pairs.push({ birth: 0, death: edges[index]!.value, dim: 0 });
  }
  const seen = new Uint8Array(n);
  for (let vertex = 0; vertex < n; vertex++) {
    const root = findRoot(parents, vertex);
    if (seen[root] === 0) {
      seen[root] = 1;
      pairs.push({ birth: 0, death: -1, dim: 0 });
    }
  }
  return { cycleEdges, pairs };
}

function coboundaryColumns(
  columns: Simplex[],
  cofaces: Simplex[],
  cofaceIndices: Map<string, number>
): ReferenceColumn[] {
  return columns.map((column) => {
    const faces: number[] = [];
    for (const coface of cofaces) {
      if (column.vertices.every((vertex) => coface.vertices.includes(vertex))) {
        faces.push(cofaceIndices.get(simplexKey(coface.vertices))!);
      }
    }
    return { faces, value: column.value };
  });
}

function reduceCoboundaries(
  columns: ReferenceColumn[],
  rowValues: number[],
  dimension: number
): { pairs: ReferencePair[]; owners: Uint8Array } {
  const owners = new Uint8Array(rowValues.length);
  const reduced = new Map<number, Set<number>>();
  const pairs: ReferencePair[] = [];
  for (const column of columns) {
    const vector = new Set(column.faces);
    while (vector.size > 0) {
      let pivot = Number.POSITIVE_INFINITY;
      for (const row of vector) {
        pivot = Math.min(pivot, row);
      }
      const previous = reduced.get(pivot);
      if (previous === undefined) {
        owners[pivot] = 1;
        reduced.set(pivot, new Set(vector));
        if (rowValues[pivot]! > column.value) {
          pairs.push({
            birth: column.value,
            death: rowValues[pivot]!,
            dim: dimension,
          });
        }
        break;
      }
      for (const row of previous) {
        if (vector.has(row)) {
          vector.delete(row);
        } else {
          vector.add(row);
        }
      }
    }
    if (vector.size === 0) {
      pairs.push({ birth: column.value, death: -1, dim: dimension });
    }
  }
  return { owners, pairs };
}

export function referenceRipsBarcode(
  points: Float64Array,
  dims: number,
  maxDist: number,
  maxHomologyDim = 2
): ReferencePair[] {
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new RangeError(
      "referenceRipsBarcode: dims must be a positive integer"
    );
  }
  if (
    !Number.isInteger(maxHomologyDim) ||
    maxHomologyDim < 0 ||
    maxHomologyDim > 2
  ) {
    throw new RangeError(
      "referenceRipsBarcode: maxHomologyDim must be 0, 1, or 2"
    );
  }
  if (points.length % dims !== 0) {
    throw new RangeError(
      "referenceRipsBarcode: points length must be divisible by dims"
    );
  }

  const n = points.length / dims;
  let effectiveMaxDist = maxDist;
  if (maxDist > 0 && !Number.isFinite(maxDist)) {
    effectiveMaxDist = computeRadiusCap(points, dims, n);
  }
  const maxDistanceSquared = effectiveMaxDist * effectiveMaxDist;
  const edgeValues = new Map<number, number>();
  for (let first = 0; first < n; first++) {
    for (let second = first + 1; second < n; second++) {
      const squared = squaredDistance(points, dims, first, second);
      if (Number.isFinite(effectiveMaxDist) && squared <= maxDistanceSquared) {
        edgeValues.set(first * n + second, Math.sqrt(squared));
      }
    }
  }

  const levels: Simplex[][] = [[], [], [], []];
  for (let vertex = 0; vertex < n; vertex++) {
    levels[0]!.push({ value: 0, vertices: [vertex] });
  }
  const maxSimplexDimension = maxHomologyDim + 1;
  for (let dimension = 1; dimension <= maxSimplexDimension; dimension++) {
    const combinations: number[][] = [];
    collectCombinations(n, dimension + 1, 0, [], combinations);
    for (const vertices of combinations) {
      let value = 0;
      let isClique = true;
      for (let first = 0; first < vertices.length; first++) {
        for (let second = first + 1; second < vertices.length; second++) {
          const edgeValue = edgeValues.get(
            vertices[first]! * n + vertices[second]!
          );
          if (edgeValue === undefined) {
            isClique = false;
            break;
          }
          value = Math.max(value, edgeValue);
        }
        if (!isClique) {
          break;
        }
      }
      if (isClique) {
        levels[dimension]!.push({ value, vertices });
      }
    }
    sortSimplices(levels[dimension]!);
  }

  const indices = levels.map((level) => {
    const result = new Map<string, number>();
    for (let index = 0; index < level.length; index++) {
      result.set(simplexKey(level[index]!.vertices), index);
    }
    return result;
  });
  const h0 = h0Reference(n, levels[1]!);
  const pairs = [...h0.pairs];
  if (maxHomologyDim < 1) {
    return canonicalReferencePairs(pairs);
  }

  const edgeColumns = coboundaryColumns(levels[1]!, levels[2]!, indices[2]!);
  const cycleColumns = edgeColumns
    .filter((_, index) => h0.cycleEdges[index])
    .toReversed();
  const h1 = reduceCoboundaries(
    cycleColumns,
    levels[2]!.map((simplex) => simplex.value),
    1
  );
  pairs.push(...h1.pairs);
  if (maxHomologyDim < 2) {
    return canonicalReferencePairs(pairs);
  }

  const triangleColumns = coboundaryColumns(
    levels[2]!,
    levels[3]!,
    indices[3]!
  );
  const unclearedTriangles = triangleColumns
    .filter((_, index) => h1.owners[index] === 0)
    .toReversed();
  const h2 = reduceCoboundaries(
    unclearedTriangles,
    levels[3]!.map((simplex) => simplex.value),
    2
  );
  pairs.push(...h2.pairs);
  return canonicalReferencePairs(pairs);
}
