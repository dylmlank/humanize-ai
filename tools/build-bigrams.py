#!/usr/bin/env python3
"""Build bigrams.json / bigrams.js — the bigram-probability table used by the
detector's predictability signal.

Source: ~4.8M tokens of human prose from NLTK (brown, reuters, gutenberg,
webtext). For each word seen >= MIN_A times, store its top-K most frequent
next words plus the probability mass that top-K covers ("m" = how concentrated
/ predictable that word's continuations are).

Usage:
    pip install nltk
    python3 tools/build-bigrams.py
Run from the repo root. Regenerate when you want a different corpus or K.
"""
import re, json, collections, os
import nltk

CORPORA = ["brown", "reuters", "gutenberg", "webtext"]
MIN_A = 200   # only keep words seen at least this often
TOP_K = 12    # continuations stored per word

for c in CORPORA:
    nltk.download(c, quiet=True)
from nltk.corpus import brown, reuters, gutenberg, webtext
CORPUS_OBJS = [brown, reuters, gutenberg, webtext]


def toks(words):
    for w in words:
        w = w.lower()
        if re.fullmatch(r"[a-z']+", w):
            yield w


def main():
    aw = []
    for c in CORPUS_OBJS:
        aw.extend(toks(c.words()))
    print(f"tokens: {len(aw):,}")

    uni = collections.Counter(aw)
    cont = collections.defaultdict(collections.Counter)
    prev = aw[0]
    for w in aw[1:]:
        cont[prev][w] += 1
        prev = w

    table = {}
    for a, counter in cont.items():
        if uni[a] < MIN_A:
            continue
        total = sum(counter.values())
        top = counter.most_common(TOP_K)
        mass = sum(c for _, c in top) / total if total else 0
        table[a] = {"n": [b for b, _ in top], "m": round(mass, 3)}

    raw = json.dumps(table, separators=(",", ":"))
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    with open(os.path.join(root, "bigrams.json"), "w") as f:
        f.write(raw)
    header = (
        "/* Auto-generated bigram-probability table (top-12 continuations + top-K\n"
        "   mass per word) built from ~4.8M tokens of human prose: NLTK brown,\n"
        "   reuters, gutenberg, webtext. Used by predictability.js. Regenerate\n"
        "   with tools/build-bigrams.py — do not edit by hand. */\n"
    )
    with open(os.path.join(root, "bigrams.js"), "w") as f:
        f.write(header + '(function(g){g.BIGRAMS=' + raw +
                ';})(typeof window!=="undefined"?window:globalThis);\n')

    print(f"words: {len(table):,}  size: {len(raw)/1024:.0f} KB")
    print("wrote bigrams.json and bigrams.js")


if __name__ == "__main__":
    main()
