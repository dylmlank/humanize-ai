// Minimal static server + optional OpenRouter "deep rewrite" proxy.
// Run: node server.js   (then open http://localhost:5180)
// Set OPENROUTER_API_KEY in env to enable the "Deep rewrite (AI)" toggle.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 5180;
const KEY = process.env.OPENROUTER_API_KEY || "";

// Free models, tried in order on rate-limit/error.
const MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-2-9b-it:free",
  "mistralai/mistral-7b-instruct:free",
];

const PROMPTS = {
  balanced: "Rewrite to sound natural and human. Vary sentence length, cut filler and AI cliches, keep the meaning. Output only the rewrite.",
  simple: "Rewrite in plain, simple language a person would actually use. Short clear sentences. Keep meaning. Output only the rewrite.",
  casual: "Rewrite in a casual, conversational human tone. Contractions, varied rhythm, no corporate filler. Keep meaning. Output only the rewrite.",
};

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json",
};

async function callOpenRouter(text, mode) {
  const sys = PROMPTS[mode] || PROMPTS.balanced;
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

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/humanize") {
    if (!KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "No OPENROUTER_API_KEY set" }));
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { text, mode } = JSON.parse(body || "{}");
        if (!text) throw new Error("no text");
        const out = await callOpenRouter(text, mode || "balanced");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ text: out }));
      } catch (e) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
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
