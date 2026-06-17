/* Detector accuracy harness against tests/labeled.json.
   Run: node tests/run.js
   Reports per-sample scores, overall accuracy, and the predictability/score
   separation between AI and human samples (for tuning thresholds). */

const path = require("path");
const fs = require("fs");

global.window = global;
global.UNIGRAMS = require(path.join(__dirname, "..", "unigrams.json"));
global.BIGRAMS = require(path.join(__dirname, "..", "bigrams.json"));
require(path.join(__dirname, "..", "predictability.js"));
require(path.join(__dirname, "..", "perplexity.js"));
require(path.join(__dirname, "..", "humanize.js"));
require(path.join(__dirname, "..", "detector.js"));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "labeled.json"), "utf8"));
const D = global.Detector, P = global.Predictability, H = global.Humanizer;

const AI_THRESH = 55;     // score >= this => called AI
const HUMAN_THRESH = 45;  // score <= this => called human

function evalSet(samples, label, isAI) {
  let correct = 0;
  const scores = [], predicts = [];
  for (const t of samples) {
    const r = D.detect(t);
    const p = P.predictability(t);
    scores.push(r.score); predicts.push(p);
    const ok = isAI ? r.score >= AI_THRESH : r.score <= HUMAN_THRESH;
    correct += ok;
    const flag = ok ? "  " : (isAI ? "✗ MISS" : "✗ FALSE+");
    console.log(`  ${label}  score=${String(r.score).padStart(2)}  predict=${p.toFixed(2)}  ${flag}`);
  }
  return { correct, total: samples.length, scores, predicts };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log("=== AI samples (want score >= " + AI_THRESH + ") ===");
const ai = evalSet(data.ai, "AI   ", true);
console.log("\n=== HUMAN samples (want score <= " + HUMAN_THRESH + ") ===");
const hu = evalSet(data.human, "HUMAN", false);

const correct = ai.correct + hu.correct;
const total = ai.total + hu.total;
console.log("\n=== SUMMARY ===");
console.log(`Accuracy: ${correct}/${total} = ${Math.round((correct / total) * 100)}%`);
console.log(`AI   score mean=${mean(ai.scores).toFixed(1)}  predict mean=${mean(ai.predicts).toFixed(2)}`);
console.log(`HUMAN score mean=${mean(hu.scores).toFixed(1)}  predict mean=${mean(hu.predicts).toFixed(2)}`);
console.log(`Predictability separation: ${(mean(ai.predicts) - mean(hu.predicts)).toFixed(2)} (bigger = better)`);

// Humanizer: confirm it drops AI scores below the human threshold.
console.log("\n=== HUMANIZER (AI samples) ===");
let dropped = 0;
for (const t of data.ai) {
  const b = D.detect(t).score;
  const a = D.detect(H.humanize(t, "balanced")).score;
  dropped += a <= HUMAN_THRESH;
  console.log(`  ${b} -> ${a}  ${a <= HUMAN_THRESH ? "✓" : "✗ still flagged"}`);
}
console.log(`Humanized below threshold: ${dropped}/${data.ai.length}`);
