/* Held-out generalization check. Unlike run.js (which is also the set the
   detector is tuned against), holdout.json is a separate set of fresh AI samples
   (generated via OpenRouter across diverse domains) and varied human writing the
   detector was NOT tuned on. This is the honest generalization number.

   Run: node tests/holdout.js */
const path = require("path");
const fs = require("fs");

global.window = global;
global.UNIGRAMS = require(path.join(__dirname, "..", "unigrams.json"));
global.BIGRAMS = require(path.join(__dirname, "..", "bigrams.json"));
require(path.join(__dirname, "..", "predictability.js"));
require(path.join(__dirname, "..", "perplexity.js"));
require(path.join(__dirname, "..", "humanize.js"));
require(path.join(__dirname, "..", "detector.js"));

const data = JSON.parse(fs.readFileSync(path.join(__dirname, "holdout.json"), "utf8"));
const D = global.Detector;

const AI_THRESH = 55, HUMAN_THRESH = 45;

function evalSet(samples, isAI) {
  let correct = 0;
  const scores = [];
  for (const t of samples) {
    const r = D.detect(t);
    scores.push(r.score);
    const ok = isAI ? r.score >= AI_THRESH : r.score <= HUMAN_THRESH;
    correct += ok;
    if (!ok) console.log(`  ${isAI ? "✗ MISS  " : "✗ FALSE+"} [${r.score}] ${t.slice(0, 70)}`);
  }
  return { correct, total: samples.length, scores };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

console.log("=== HELD-OUT (not tuned on) ===");
const ai = evalSet(data.ai, true);
const hu = evalSet(data.human, false);
const correct = ai.correct + hu.correct, total = ai.total + hu.total;
console.log(`\nHeld-out accuracy: ${correct}/${total} = ${Math.round((correct / total) * 100)}%`);
console.log(`AI    mean=${mean(ai.scores).toFixed(1)}  (want high)`);
console.log(`HUMAN mean=${mean(hu.scores).toFixed(1)}  (want low)`);
console.log(`Separation: ${(mean(ai.scores) - mean(hu.scores)).toFixed(1)}`);
