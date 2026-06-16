# Humanize AI

Turn AI-generated text into natural, human-sounding writing. Two-panel web app inspired by humanizeai.pro — clean, light/dark, no build step.

## Run

```bash
cd ~/humanize-ai
node server.js      # → http://localhost:5180
```

Or just open `index.html` directly — the local rewriter works fully offline (only the optional AI pass needs the server).

## How it works

**Local engine (`humanize.js`)** — instant, offline, free. Targets common "AI tells":
- Cuts bloated phrases (*"in order to"* → *"to"*, *"due to the fact that"* → *"because"*)
- Removes filler lead-ins (*"It is important to note that…"*)
- Thins transition spam (*Moreover, Furthermore, Consequently…*)
- Breaks uniform run-on sentences to vary rhythm
- Swaps corporate verbs (*utilize* → *use*, *leverage* → *use*)
- Adds light contractions
- Replaces em-dashes with hyphens

**Modes:** Balanced · Simple · Casual

**AI Detector (`detector.js`)** — heuristic scorer (0–100) with a breakdown. Signals: sentence-length burstiness, AI-cliché density, vocabulary variety, hedging/filler, contraction use, em-dash regularity. Check your text *or* the humanized output — humanizing typically drops the score sharply. It's an estimate, not a verdict.

**Deep rewrite (AI)** — optional toggle. Proxies through OpenRouter free models with 429 fallback:

```bash
OPENROUTER_API_KEY=sk-... node server.js
```

Falls back to the local engine automatically if the API is unavailable.

## Honest note

No tool can guarantee bypassing every AI detector — detectors change constantly and any guarantee is marketing. This improves clarity and readability. Use it to write better, not to deceive.
