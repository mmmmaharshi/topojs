/**
 * Streaming persistent homology — Phase A proof-of-concept demo.
 *
 * Simulates a live 2D point stream (e.g. a sensor/telemetry feed) that
 * starts as unstructured noise and then transitions into a ring-shaped
 * pattern (a topological "event" — a loop forming). Runs the naive
 * StreamingHomology wrapper over the stream and prints the real-time
 * topological summary signal per step, entirely client-side (no server,
 * no pre-collected dataset — every point is computed on as it "arrives").
 *
 * This validates the applied story before investing in true incremental
 * (vineyard-style) updates: does the naive sliding-window approach even
 * produce a usable real-time signal? Run with:
 *   node --experimental-transform-types bench/streaming-poc.ts
 */
import { StreamingHomology } from '../src/streaming/streaming-homology.ts';
import { summarizeForStreaming } from '../src/streaming/topological-summary.ts';

function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WINDOW_SIZE = 16;
const MAX_DIST = 0.6;
const SIGNIFICANCE = 0.05;
const NOISE_STEPS = 40;
const RING_STEPS = 40;

const rng = mulberry32(20260710);

function noisePoint(): [number, number] {
  return [rng() * 0.05, rng() * 0.05];
}

function ringPoint(i: number, pointsPerRevolution: number): [number, number] {
  // IMPORTANT: pointsPerRevolution must equal WINDOW_SIZE (not RING_STEPS) --
  // the sliding window only ever holds the most recent WINDOW_SIZE points,
  // so a loop can only close once one full revolution's worth of points
  // is simultaneously in the window. Using RING_STEPS here would spread
  // one revolution across more pushes than the window can hold at once,
  // so the window would only ever see an open arc, never a closed loop.
  const angle = (2 * Math.PI * (i % pointsPerRevolution)) / pointsPerRevolution;
  // Small per-step jitter so consecutive ring points aren't perfectly
  // noise-free (more representative of a real sensor stream).
  const jitter = (rng() - 0.5) * 0.02;
  return [Math.cos(angle) + jitter, Math.sin(angle) + jitter];
}

console.log('='.repeat(72));
console.log('  Streaming Persistent Homology -- Phase A Proof of Concept');
console.log('  window=' + WINDOW_SIZE + '  maxDist=' + MAX_DIST + '  significance=' + SIGNIFICANCE);
console.log('='.repeat(72));
console.log();
console.log('step  phase   windowSize  isFull  essentialH1  significantH1  maxPersistH1');
console.log('-'.repeat(72));

const stream = new StreamingHomology({
  windowSize: WINDOW_SIZE,
  dims: 2,
  maxDist: MAX_DIST,
  maxDim: 2,
});

let firstLoopDetectedAtStep = -1;
let step = 0;

function runStep(phase: string, point: [number, number]): void {
  step++;
  const update = stream.push(point);
  if (update === null) {
    console.log(`${String(step).padStart(4)}  ${phase.padEnd(6)}  ${update === null ? '(warming up)' : ''}`);
    return;
  }
  const summary = summarizeForStreaming(update.result.pairs, SIGNIFICANCE);
  const loops = summary.essentialH1Count + summary.significantH1Count;
  if (loops >= 1 && firstLoopDetectedAtStep < 0) firstLoopDetectedAtStep = step;
  console.log(
    `${String(step).padStart(4)}  ${phase.padEnd(6)}  ${String(update.windowSize).padStart(10)}  ` +
      `${String(update.isFull).padStart(6)}  ${String(summary.essentialH1Count).padStart(11)}  ` +
      `${String(summary.significantH1Count).padStart(13)}  ${summary.maxPersistenceH1.toFixed(4).padStart(12)}`,
  );
}

for (let i = 0; i < NOISE_STEPS; i++) runStep('noise', noisePoint());
for (let i = 0; i < RING_STEPS; i++) runStep('ring', ringPoint(i, WINDOW_SIZE));

console.log('-'.repeat(72));
if (firstLoopDetectedAtStep >= 0) {
  const stepsAfterRingStart = firstLoopDetectedAtStep - NOISE_STEPS;
  console.log(
    `RESULT: loop first detected at step ${firstLoopDetectedAtStep} ` +
      `(${stepsAfterRingStart} steps after the ring phase began, ` +
      `${WINDOW_SIZE} points needed to fully displace noise from the window).`,
  );
  console.log('Proof of concept: naive sliding-window streaming DOES surface a real-time');
  console.log('topological signal change, entirely client-side, using only the existing');
  console.log('computePersistentHomology path (no incremental/vineyard algorithm needed');
  console.log('for this signal to already be useful).');
} else {
  console.log('RESULT: no loop detected -- proof of concept FAILED. Check MAX_DIST/geometry.');
  process.exitCode = 1;
}
