import { execSync } from 'child_process';

const axes = [
  'axis5_CubicalScaling',
  'axis6_MemoryProfiling',
  'axis7_WorkerSpeedup',
  'axis8_MaxDimScaling',
  'axis9_TriVsTime',
  'axis10_DenseVsSparse',
];

// Quick test: build a standalone runner that imports and calls each
console.log('=== Running axes 5-10 individually ===');
for (const ax of axes) {
  console.log(`\n--- Running ${ax} ---`);
  try {
    const out = execSync(
      `node --experimental-transform-types -e `
      + `"import('./bench/scalability.ts').then(m => m.${ax}()).catch(e => { console.error(e); process.exit(1); })"`,
      { cwd: 'C:\\Users\\manoh\\OneDrive\\Desktop\\tda-js', timeout: 120000, shell: true, encoding: 'utf8' }
    );
    console.log(out);
  } catch (e) {
    console.log(e.stdout || '');
    console.error(`FAILED: ${ax}: ${e.message}`);
    if (e.stderr) console.error(e.stderr);
  }
}
console.log('\n=== Done ===');
