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

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json",
};

async function callOpenRouter(text, sys) {
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
          temperature: 0.9,
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
