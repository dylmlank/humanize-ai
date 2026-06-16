(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const input = $("input"), output = $("output");
  const inWords = $("inWords"), outWords = $("outWords");
  const status = $("status");
  let mode = "balanced";

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
    input.value = ""; output.value = "";
    inWords.textContent = "0"; outWords.textContent = "0";
  };
  $("copyBtn").onclick = async () => {
    if (!output.value) return;
    try { await navigator.clipboard.writeText(output.value); setStatus("Copied!", 1500); }
    catch { output.select(); document.execCommand("copy"); setStatus("Copied!", 1500); }
  };

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
            output.value = info.text;
            outWords.textContent = wc(info.text);
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

    output.value = result;
    outWords.textContent = wc(result);

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
    const text = (detectTarget === "output" ? output.value : input.value).trim();
    const result = window.Detector.detect(text);
    window.renderDetector(detectorBody, result);
  }

  document.querySelectorAll(".seg-sm .seg-btn").forEach((b) => {
    b.onclick = () => { detectTarget = b.dataset.target; syncDetectTabs(); runDetect(); };
  });
  $("detectBtn").onclick = runDetect;
})();
