(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const input = $("input"), output = $("output");
  const inWords = $("inWords"), outWords = $("outWords");
  const changePctEl = $("changePct");
  const status = $("status");
  let mode = "balanced";

  // The output is a rich (highlightable) div now, so we keep the plain text
  // result separately for copy / detection / word counts.
  let outputText = "";
  const getOutput = () => outputText;
  // Render the humanized text into the output panel, optionally highlighting
  // what changed from `original`. Always updates word count + change %.
  function setOutput(text, original) {
    outputText = text || "";
    if (text && original != null && $("showDiff").checked && window.Diff) {
      const d = window.Diff.diffWords(original, text);
      output.innerHTML = d.html;
      changePctEl.textContent = d.changePct + "%";
    } else {
      output.textContent = text || "";
      changePctEl.textContent = "0%";
    }
    outWords.textContent = wc(outputText);
  }

  const wc = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  const setStatus = (msg, ms) => {
    status.textContent = msg;
    if (ms) setTimeout(() => { if (status.textContent === msg) status.textContent = ""; }, ms);
  };

  // Theme
  const root = document.documentElement;
  const themeToggle = $("themeToggle");
  const savedTheme = localStorage.getItem("hz-theme");
  if (savedTheme) root.setAttribute("data-theme", savedTheme);
  const syncThemeIcon = () =>
    (themeToggle.textContent = root.getAttribute("data-theme") === "dark" ? "☀️" : "🌙");
  syncThemeIcon();
  themeToggle.onclick = () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("hz-theme", next);
    syncThemeIcon();
  };

  // Mode buttons
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      mode = btn.dataset.mode;
    };
  });

  // Word counts
  input.addEventListener("input", () => (inWords.textContent = wc(input.value)));

  // Sample / clear / copy
  $("sampleBtn").onclick = () => {
    input.value = window.Humanizer.SAMPLE;
    inWords.textContent = wc(input.value);
    setStatus("Sample loaded", 1500);
  };
  $("clearBtn").onclick = () => {
    input.value = ""; setOutput("");
    inWords.textContent = "0";
    $("scoreStrip").hidden = true;
  };
  $("copyBtn").onclick = async () => {
    const text = getOutput();
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setStatus("Copied!", 1500); }
    catch { setStatus("Copy failed", 1500); }
  };
  // Re-render highlights live when the toggle changes.
  $("showDiff").addEventListener("change", () => {
    if (getOutput()) setOutput(getOutput(), input.value.trim());
  });

  // LLM deep rewrite via local proxy (server.js). Falls back to local on failure.
  async function llmHumanize(text, mode) {
    const res = await fetch("/api/humanize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode }),
    });
    if (!res.ok) throw new Error("LLM unavailable");
    const data = await res.json();
    if (!data.text) throw new Error("Empty response");
    return data.text;
  }

  // Regenerate from scratch: summarize -> rewrite fresh from the notes, then run
  // the rule-based humanizer as a finishing pass. Breaks the AI sentence
  // skeleton entirely (the user's concept). Returns the final humanized text.
  // `feedback` (optional) names the AI tells that survived a prior round so the
  // regeneration prompt can target them; `round` escalates aggressiveness.
  async function llmRegenerate(text, mode, feedback, round) {
    const res = await fetch("/api/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, mode, feedback, round }),
    });
    if (!res.ok) throw new Error("LLM unavailable");
    const data = await res.json();
    if (!data.text) throw new Error("Empty response");
    // Finishing pass: apply our deterministic guidelines on top of the LLM draft.
    return window.Humanizer.humanize(data.text, mode);
  }

  // (systemPrompt, userText) => rewritten text, via the server proxy.
  async function llmRewrite(systemPrompt, userText) {
    const res = await fetch("/api/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system: systemPrompt, text: userText }),
    });
    if (!res.ok) throw new Error("LLM unavailable");
    const data = await res.json();
    if (!data.text) throw new Error("Empty response");
    return data.text;
  }

  // Fill the before/after AI-likelihood strip from detector scores.
  function showScoreStrip(original, humanized) {
    const before = window.Detector.detect(original);
    const after = window.Detector.detect(humanized);
    const strip = $("scoreStrip");

    const fmt = (r) => (r.score == null ? "–" : r.score + "%");
    const tag = (r) => (r.score == null ? "(need ~20 words)" : r.label);
    const colorFor = (s) =>
      s == null ? "var(--muted)" : s >= 70 ? "#ef4444" : s >= 45 ? "#f59e0b" : "#22c55e";

    $("beforeScore").textContent = fmt(before);
    $("beforeScore").style.color = colorFor(before.score);
    $("beforeTag").textContent = tag(before);

    $("afterScore").textContent = fmt(after);
    $("afterScore").style.color = colorFor(after.score);
    $("afterTag").textContent = tag(after);

    const delta = $("scoreDelta");
    if (before.score != null && after.score != null) {
      const drop = before.score - after.score;
      delta.hidden = false;
      if (drop > 0) { delta.className = "score-delta good"; delta.textContent = `▼ ${drop} pts less AI`; }
      else if (drop < 0) { delta.className = "score-delta bad"; delta.textContent = `▲ ${-drop} pts more AI`; }
      else { delta.className = "score-delta"; delta.textContent = "no change"; }
    } else {
      delta.hidden = true;
    }
    strip.hidden = false;
  }

  const btn = $("humanizeBtn");
  btn.onclick = async () => {
    const text = input.value.trim();
    if (!text) { setStatus("Paste some text first", 2000); return; }

    const useLLM = $("useLLM").checked;
    const loop = $("untilUndetectable").checked;
    btn.disabled = true;
    let result;

    try {
      if (loop) {
        const regen = $("regenerate").checked && useLLM;
        const res = await window.loopHumanize(text, {
          mode,
          target: 30,
          maxRounds: useLLM ? 5 : 3,
          // Regenerate-loop (rebuild from meaning each round) when "Rewrite from
          // scratch" is on; otherwise single-pass LLM rewrite; else local-only.
          regenerate: regen ? llmRegenerate : null,
          llm: useLLM && !regen ? llmRewrite : null,
          onRound: (info) => {
            setOutput(info.text, text);
            setStatus(`Round ${info.round + 1} · ${info.via} · score ${info.score}`);
          },
        });
        result = res.text;
        setStatus(
          res.hitTarget
            ? `Undetectable ✓ (${res.score}% AI, ${res.rounds} rounds)`
            : `Best effort: ${res.score}% AI after ${res.rounds} rounds`,
          4000
        );
      } else {
        result = window.Humanizer.humanize(text, mode);
        if (useLLM) {
          const regen = $("regenerate").checked;
          setStatus(regen ? "Summarizing & rewriting…" : "Deep rewriting…");
          try {
            result = regen ? await llmRegenerate(text, mode) : await llmHumanize(text, mode);
          } catch { setStatus("AI unavailable — used local rewrite", 2500); }
        }
        setStatus("Done", 1500);
      }
    } catch (e) {
      if (!result) result = window.Humanizer.humanize(text, mode);
      setStatus("AI unavailable — used local rewrite", 2500);
    } finally {
      btn.disabled = false;
    }

    setOutput(result, text);
    showScoreStrip(text, result);

    // Auto-check the humanized output so the user sees the before/after drop.
    detectTarget = "output";
    syncDetectTabs();
    runDetect();

    // Retrospective: reflect on this run and learn from it (non-blocking).
    // Use the richer LLM reflection only when "Deep rewrite (AI)" is enabled.
    runRetrospective(text, result, $("useLLM").checked);
  };

  // ---- Retrospective: learn from each run ----
  // After every humanize, reflect on what the detector still flagged in the
  // output and persist learnings (new tells + replacements) that load into
  // future runs. Uses the LLM when available, else a deterministic fallback.
  // useLLM=false: fast, free, offline rule-based reflection (runs on every
  // humanize). useLLM=true: deeper LLM reflection (the explicit "Reflect" button
  // or when "Deep rewrite (AI)" is on) — richer learnings, costs an API call.
  async function runRetrospective(input, output, useLLM) {
    if (!window.Retrospective || !window.Learnings) return;
    try {
      const after = window.Detector.detect(output);
      const survived = (after.signals || []).filter((s) => s.contribution >= 25);
      const run = {
        input,
        output,
        beforeScore: window.Detector.detect(input).score,
        afterScore: after.score,
        survivedSignals: survived,
      };
      const reflector = useLLM ? llmRewrite : null;
      const res = await window.Retrospective.reflect(run, reflector);
      if (res && res.added) {
        const a = res.added;
        const n = a.phrases + a.replacements + a.notes;
        if (n > 0) {
          setStatus(`Learned ${a.phrases} tell(s), ${a.replacements} fix(es)`, 3000);
          renderLearnings();
        }
      }
    } catch { /* learning is best-effort; never block the user */ }
  }

  // ---- Detector ----
  let detectTarget = "input";
  const detectorBody = $("detectorBody");

  function syncDetectTabs() {
    document.querySelectorAll(".seg-sm .seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.target === detectTarget)
    );
  }
  function runDetect() {
    const text = (detectTarget === "output" ? getOutput() : input.value).trim();
    const result = window.Detector.detect(text);
    window.renderDetector(detectorBody, result);
  }

  document.querySelectorAll(".seg-sm .seg-btn").forEach((b) => {
    b.onclick = () => { detectTarget = b.dataset.target; syncDetectTabs(); runDetect(); };
  });
  $("detectBtn").onclick = runDetect;

  // ---- Learnings panel ----
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function renderLearnings() {
    const body = $("learningsBody");
    if (!window.Learnings) { return; }
    const d = window.Learnings.load();
    const total = d.phrases.length + d.replacements.length;
    $("learnCount").textContent = total
      ? `${d.phrases.length} tells · ${d.replacements.length} fixes` : "";
    if (!total && !d.notes.length) {
      body.innerHTML =
        '<p class="detector-empty">After each humanize, the tool reflects on what the ' +
        'detector still caught and learns new AI tells &amp; fixes — which then improve ' +
        'future detection automatically.</p>';
      return;
    }
    const chips = (arr, cls) =>
      arr.slice(-30).map((x) => `<span class="learn-chip ${cls}">${esc(x)}</span>`).join("");
    const repChips = d.replacements.slice(-30)
      .map((r) => `<span class="learn-chip fix">${esc(r.from)} → ${esc(r.to)}</span>`).join("");
    body.innerHTML =
      (d.phrases.length ? `<div class="learn-group"><b>Learned AI tells</b><div class="learn-chips">${chips(d.phrases, "tell")}</div></div>` : "") +
      (d.replacements.length ? `<div class="learn-group"><b>Learned fixes</b><div class="learn-chips">${repChips}</div></div>` : "") +
      (d.notes.length ? `<div class="learn-group"><b>Notes</b><ul class="learn-notes">${d.notes.slice(-10).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "");
  }

  $("clearLearnBtn").onclick = () => {
    if (window.Learnings) { window.Learnings.clear(); renderLearnings(); setStatus("Learnings cleared", 1500); }
  };
  // "Reflect" runs a deeper LLM reflection on the current input/output on demand.
  $("deepRetroBtn").onclick = async () => {
    const inp = input.value.trim(), outp = getOutput();
    if (!inp || !outp) { setStatus("Humanize something first", 2000); return; }
    setStatus("Reflecting…");
    await runRetrospective(inp, outp, true);  // explicit Reflect = deep LLM pass
    renderLearnings();
    setStatus("Reflection done", 1500);
  };

  renderLearnings();
})();
