// Minimal static server + optional OpenRouter "deep rewrite" proxy.
// Run: node server.js   (then open http://localhost:5180)
// Set OPENROUTER_API_KEY in env to enable the "Deep rewrite (AI)" toggle.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5180;

// Key resolution order: env var, then a gitignored local file (key.txt).
// Never hardcode the key — keep it out of version control.
function resolveKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  try {
    return fs.readFileSync(path.join(__dirname, "key.txt"), "utf8").trim();
  } catch {
    return "";
  }
}
const KEY = resolveKey();

// Free models, tried in order on rate-limit/error.
const MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "google/gemma-4-31b-it:free",
  "openai/gpt-oss-20b:free",
];

const RULES =
  " Keep it concise and simple. Use short, plain sentences with varied length. " +
  "Do NOT use hyphens or dashes of any kind. Cut filler and AI cliches. " +
  "Keep the meaning. Output only the rewrite.";
const PROMPTS = {
  balanced: "Rewrite to sound natural and human." + RULES,
  simple: "Rewrite in plain, simple language a person would actually use." + RULES,
  casual: "Rewrite in a casual, conversational human tone with contractions." + RULES,
};

// "Regenerate from scratch" — extract the meaning into styleless notes, then
// rewrite fresh from ONLY those notes so the AI's original sentence skeleton
// (itself the strongest tell) is gone. Two prompts, run in sequence.
//
// The summarize step is the heart of the approach: by reducing the text to bare
// fact fragments we strip ALL of the original phrasing, rhythm, transitions, and
// structure. The regenerate step then has nothing of the AI's fingerprint left
// to copy — it must build sentences from scratch. We force the notes to be terse
// fragments (no full sentences, no connectors) so none of the source wording
// survives into the rewrite.
const SUMMARIZE_PROMPT =
  "Reduce the text to its bare facts as a flat list of short note fragments. " +
  "Rules: each note is 2 to 7 words, telegraphic style (like jotted notes), no " +
  "full sentences, no transitions, no adjectives that aren't load-bearing, no " +
  "opinions, no formatting words. Capture every distinct fact, claim, name, " +
  "number, and step. Drop all of the original phrasing and sentence structure. " +
  "Output ONLY the notes, one per line, each starting with '- '.";
// These rules target the signals trusted detectors actually measure: low
// perplexity (predictable word choice) and low burstiness (uniform rhythm). The
// burstiness instruction is FIRST and most specific because it's the dominant
// tell — every other rule is secondary to breaking the flat AI rhythm.
// Encodes what actually moves real detectors: hard sentence-length variance
// (burstiness), lower-probability word choice (perplexity), and removal of the
// structural + lexical fingerprints detectors and humans flag.
const REGENERATE_RULES =
  " You are given NOTES, not prose — build the writing yourself from the facts. " +
  "1) Vary sentence length HARD: include at least one very short sentence (under " +
  "6 words) and at least one long one (over 30 words); never put two similar " +
  "lengths in a row. " +
  "2) Use plain, everyday words. Prefer short common words over long formal or " +
  "Latinate ones (say 'use' not 'utilize', 'set up' not 'infrastructure' where " +
  "you can, 'grow' not 'scale'). Pick the specific, slightly unexpected word over " +
  "the safe generic one, but keep it simple and correct. " +
  "3) Use contractions throughout — at least three (it's, don't, you'll, they're, " +
  "that's). This is required. Start a sentence with 'And', 'But', or 'So' once. " +
  "Add one short opinionated aside. " +
  "4) Reorder the points freely if it flows better; you don't have to follow the " +
  "note order. " +
  "NEVER use these words: delve, underscore, showcase, intricate, meticulous, " +
  "commendable, leverage, foster, seamless, robust, crucial, comprehensive, " +
  "tapestry, realm, testament, multifaceted, navigate, boast, vibrant, pivotal. " +
  "NO em-dashes or hyphens. NO three-item lists (use two or four). NO 'not only X " +
  "but also Y' or 'it's not just X, it's Y'. NO 'serves as / acts as' (just say " +
  "'is'). NO 'Moreover/Furthermore/Additionally'. NO formulaic intro or closer " +
  "like 'in conclusion' or 'the future looks bright'. NO 'First,/Second,/Finally,' " +
  "scaffolding. Cover all the facts and keep about the same length. Output only " +
  "the final text.";
const REGENERATE_PROMPTS = {
  balanced: "Write a natural, human paragraph from these notes." + REGENERATE_RULES,
  simple: "Write plainly, in simple language a real person would use, from these notes." + REGENERATE_RULES,
  casual: "Write in a casual, conversational human voice from these notes." + REGENERATE_RULES,
};

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json",
};

// Sampling presets. The biggest lever for evading statistical detectors is
// sampling config, not prompt wording: a higher temperature + repetition/
// frequency penalties push token choices toward lower-probability (higher
// perplexity) continuations, which is exactly what detectors measure. Research
// (arXiv:2510.13681) found temp ~1.1 with a repetition penalty drops Binoculars
// AUROC from ~0.95 to near zero. We use a hot preset for the rewrite, but keep
// the summarize step cool so the extracted notes stay accurate.
const SAMPLING = {
  // Rewrite/regenerate: warm, with light penalties to break the flat AI token
  // stream WITHOUT tipping into incoherence. Tested higher (1.15 + 0.5 penalty)
  // and it produced odd, lower-quality text that sometimes read MORE artificial;
  // ~1.05 with gentle penalties is the sweet spot — varied word choice, still
  // fluent.
  human: { temperature: 1.05, top_p: 0.97, frequency_penalty: 0.3, presence_penalty: 0.2 },
  // Summarize: cool and faithful — we want correct notes, not creativity.
  precise: { temperature: 0.3, top_p: 0.9 },
};

async function callOpenRouter(text, sys, sampling) {
  const samp = sampling || SAMPLING.human;
  let lastErr = "no models";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: text },
          ],
          ...samp,
        }),
      });
      if (r.status === 429) { lastErr = "rate limited"; continue; }
      if (!r.ok) { lastErr = `HTTP ${r.status}`; continue; }
      const data = await r.json();
      const out = data?.choices?.[0]?.message?.content?.trim();
      if (out) return out;
      lastErr = "empty";
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr);
}

const readBody = (req) =>
  new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => resolve(b));
  });

const server = http.createServer(async (req, res) => {
  // Mode-based humanize (single pass).
  if (req.method === "POST" && req.url === "/api/humanize") {
    if (!KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No OPENROUTER_API_KEY set" }));
    }
    try {
      const { text, mode } = JSON.parse((await readBody(req)) || "{}");
      if (!text) throw new Error("no text");
      const out = await callOpenRouter(text, PROMPTS[mode] || PROMPTS.balanced);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: out }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Arbitrary-system-prompt rewrite — used by the "loop until undetectable" loop.
  if (req.method === "POST" && req.url === "/api/rewrite") {
    if (!KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No OPENROUTER_API_KEY set" }));
    }
    try {
      const { text, system } = JSON.parse((await readBody(req)) || "{}");
      if (!text) throw new Error("no text");
      const out = await callOpenRouter(text, system || PROMPTS.balanced);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: out }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Regenerate from scratch: summarize -> rewrite fresh from the notes. This
  // breaks the AI's sentence structure entirely, not just its word choices.
  if (req.method === "POST" && req.url === "/api/regenerate") {
    if (!KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No OPENROUTER_API_KEY set" }));
    }
    try {
      const { text, mode, feedback, round } = JSON.parse((await readBody(req)) || "{}");
      if (!text) throw new Error("no text");
      // Summarize cool/faithful so the notes are accurate.
      const notes = await callOpenRouter(text, SUMMARIZE_PROMPT, SAMPLING.precise);
      // Escalate when looping: feed back which AI tells survived, and push
      // harder each round so resistant text gets broken up more aggressively.
      let sys = REGENERATE_PROMPTS[mode] || REGENERATE_PROMPTS.balanced;
      if (round > 0) {
        sys += " The previous attempt STILL read like AI. The detector still sees " +
          "uniform sentence rhythm and predictable word choice. Be far more " +
          "aggressive: smash the even rhythm (some 3-word sentences, some 25-word " +
          "ones, never two similar lengths in a row), start every sentence " +
          "differently, choose vivid specific words over safe generic ones, and " +
          "add natural contractions.";
      }
      if (feedback) {
        sys += ` Specifically fix these AI tells the detector still found: ${String(feedback).slice(0, 200)}.`;
      }
      // Regenerate hot, and turn the heat UP each round to push perplexity higher
      // on stubborn text (within a quality-safe ceiling).
      const regenSampling = {
        ...SAMPLING.human,
        temperature: Math.min(1.05 + round * 0.05, 1.2),
      };
      const out = await callOpenRouter(notes, sys, regenSampling);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ text: out, notes }));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Static files
  let file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const fp = path.join(__dirname, path.normalize(file).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Humanize AI → http://localhost:${PORT}`));
