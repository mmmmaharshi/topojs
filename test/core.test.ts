import { describe, it, expect } from "vitest";

import { UnionFind } from "../src/core/unionfind.ts";

describe("unionfind", () => {
  /* eslint-disable vitest/max-expects */
  it("union/find collapses components correctly", () => {
    const uf = new UnionFind(5);
    expect(uf.find(0)).toBe(0);
    expect(uf.find(4)).toBe(4);
    expect(uf.union(0, 1)).toBeTruthy();
    expect(uf.find(0)).toBe(uf.find(1));
    expect(uf.union(0, 1)).toBeFalsy(); // already joined
    uf.union(2, 3);
    expect(uf.find(0)).not.toBe(uf.find(2));
    uf.union(1, 2);
    expect(uf.find(0)).toBe(uf.find(3));
  });
  /* eslint-enable vitest/max-expects */
});
