import type { TetraEntry } from "./complex.ts";

export function buildFlippedTetrahedronCoboundary(
  triangleCount: number,
  tetrahedra: readonly TetraEntry[]
): { columns: Int32Array; start: Int32Array } {
  // Tetrahedron faces are valid triangle indices, and the loop index stays in range.
  const counts = new Int32Array(triangleCount);
  for (const tetrahedron of tetrahedra) {
    for (const triangle of tetrahedron.triangles) {
      counts[triangle]!++;
    }
  }

  const start = new Int32Array(triangleCount + 1);
  let running = 0;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    start[triangle] = running;
    running += counts[triangle]!;
  }
  start[triangleCount] = running;

  const columns = new Int32Array(running);
  const fillPosition = Int32Array.from(start.subarray(0, triangleCount));
  for (
    let tetrahedronIndex = 0;
    tetrahedronIndex < tetrahedra.length;
    tetrahedronIndex++
  ) {
    const flippedIndex = tetrahedra.length - 1 - tetrahedronIndex;
    for (const triangle of tetrahedra[tetrahedronIndex]!.triangles) {
      columns[fillPosition[triangle]!++] = flippedIndex;
    }
  }

  return { columns, start };
}
