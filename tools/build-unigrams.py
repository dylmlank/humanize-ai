#!/usr/bin/env python3
"""Build unigrams.json / unigrams.js — the word-frequency table the detector's
perplexity engine uses as its backbone signal.

The single strongest cheap signal for AI text is word commonness: LLMs
over-pick high-frequency "safe" words and rarely reach into the long tail, so
their average per-word surprisal (-log p(word)) is LOW. Humans use rarer words
more often -> higher surprisal -> higher perplexity. We approximate p(word)
from a large human corpus.

We store, per word: a smoothed log-probability bucket. To keep the file small we
keep the ~12k most frequent words; everything else is treated as the
out-of-vocabulary (OOV) floor, which is itself a strong human tell (rare/odd
words). We also emit corpus stats (token count, vocab size, OOV logprob) so the
JS side can score unseen words consistently.

Usage:
    pip install nltk
    python3 tools/build-unigrams.py
Run from the repo root.
"""
import re, json, math, collections, os
import nltk

CORPORA = ["brown", "reuters", "gutenberg", "webtext"]
KEEP = 12000          # keep this many most-frequent words
MIN_COUNT = 2         # ignore hapax noise below this

for c in CORPORA:
    nltk.download(c, quiet=True)
from nltk.corpus import brown, reuters, gutenberg, webtext
CORPUS_OBJS = [brown, reuters, gutenberg, webtext]

WORD = re.compile(r"[a-z']+")

def tokens():
    for corpus in CORPUS_OBJS:
        for w in corpus.words():
            w = w.lower()
            if WORD.fullmatch(w):
                yield w

print("counting tokens ...")
counts = collections.Counter(tokens())
total = sum(counts.values())
print(f"total tokens: {total:,}  vocab: {len(counts):,}")

# Keep the most frequent KEEP words above MIN_COUNT.
common = [(w, c) for w, c in counts.most_common(KEEP) if c >= MIN_COUNT]
kept_total = sum(c for _, c in common)

# Laplace-ish smoothing constant so unseen words get a sane floor.
V = len(counts)
# Store integer log-prob * -100 (negative log prob scaled) to keep the table
# small and integer-valued. nlp = round(-log(p) * 100). Higher = rarer/surprising.
table = {}
for w, c in common:
    p = c / total
    table[w] = round(-math.log(p) * 100)

# OOV surprisal: treat an unseen word as if it appeared ~0.5 times.
oov_p = 0.5 / total
oov_nlp = round(-math.log(oov_p) * 100)

# Reference percentiles of per-word surprisal across the corpus (token-weighted),
# so the JS side can normalize a document's mean surprisal to a 0..1 scale.
nlps = []
for w, c in counts.items():
    if WORD.fullmatch(w):
        p = c / total
        nlps.append((-math.log(p) * 100, c))
nlps.sort(key=lambda x: x[0])
acc = 0
pcts = {}
targets = {0.10: None, 0.25: None, 0.5: None, 0.75: None, 0.9: None}
for val, c in nlps:
    acc += c
    frac = acc / total
    for t in list(targets):
        if targets[t] is None and frac >= t:
            targets[t] = round(val)
print("surprisal percentiles (nlp*100):", targets)

out = {
    "total": total,
    "vocab": V,
    "oov": oov_nlp,
    "pct": {str(k): v for k, v in targets.items()},
    "w": table,
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(root, "unigrams.json"), "w") as f:
    json.dump(out, f, separators=(",", ":"))

js = ("/* Auto-generated unigram log-frequency table for the perplexity engine.\n"
      "   Built by tools/build-unigrams.py from NLTK brown/reuters/gutenberg/webtext.\n"
      "   w[word] = round(-log(p(word)) * 100); higher = rarer/more surprising.\n"
      "   Loaded as window.UNIGRAMS (browser) or require('./unigrams.json') (node). */\n"
      "(function (g) { g.UNIGRAMS = " + json.dumps(out, separators=(",", ":")) + "; })"
      "(typeof window !== 'undefined' ? window : globalThis);\n")
with open(os.path.join(root, "unigrams.js"), "w") as f:
    f.write(js)

print(f"wrote unigrams.json / unigrams.js  ({len(table):,} words, oov nlp={oov_nlp})")
