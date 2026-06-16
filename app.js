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
        const res = await window.loopHumanize(text, {
          mode,
          target: 30,
          maxRounds: useLLM ? 5 : 3,
          llm: useLLM ? llmRewrite : null,
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
          setStatus("Deep rewriting…");
          try { result = await llmHumanize(text, mode); }
          catch { setStatus("AI unavailable — used local rewrite", 2500); }
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
  };

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
})();
