// Run axes 5-10 individually for incremental data collection
import {
  axis5_CubicalScaling,
  axis6_MemoryProfiling,
  axis7_WorkerSpeedup,
  axis8_MaxDimScaling,
  axis9_TriVsTime,
  axis10_DenseVsSparse,
} from './scalability.ts';

async function main() {
  const axes: [string, () => void | Promise<void>][] = [
    ['Axis 5 (Cubical)', () => axis5_CubicalScaling()],
    ['Axis 6 (Memory)', () => axis6_MemoryProfiling()],
    ['Axis 7 (Workers)', () => axis7_WorkerSpeedup()],
    ['Axis 8 (maxDim)', () => axis8_MaxDimScaling()],
    ['Axis 9 (Regress)', () => axis9_TriVsTime()],
    ['Axis 10 (Dense)', () => axis10_DenseVsSparse()],
  ];

  for (const [name, fn] of axes) {
    console.log(`\n=== ${name} ===`);
    const t0 = performance.now();
    try {
      const result = fn();
      if (result instanceof Promise) await result;
    } catch (e) {
      console.error(`${name} FAILED:`, e);
    }
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
    console.log(`  [${name} took ${elapsed}s]`);
  }
  console.log('\n=== All done ===');
}

main();
