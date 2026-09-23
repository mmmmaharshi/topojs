export function validateMaxDim(
  maxDim: number,
  entryPoint = "computePersistentHomology"
): void {
  if (!Number.isInteger(maxDim) || maxDim < 0 || maxDim > 2) {
    throw new RangeError(
      `${entryPoint}: maxDim must be 0, 1, or 2, got ${maxDim}`
    );
  }
}

export function toEngineMaxDim(maxDim: number): number {
  return maxDim + 1;
}
