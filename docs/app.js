/* ============================================================
   apogee - working extension demo (all client-side, no network)
   ============================================================ */
(function () {
  "use strict";

  // --- Source "article" the demo summarizes. Each paragraph has a key. ---
  var PARAS = {
    1: "Orbit-class assistants promised to read the web for you, but most quietly shipped every page you visited to a server you couldn't see.",
    2: "apogee takes the opposite path: the model runs on your own machine. Nothing about the page you're reading is uploaded, logged, or used for training.",
    3: "On Chromium browsers it runs on your GPU through WebGPU. On Firefox it defaults to WebAssembly on the CPU, and you can point it at your own local Ollama for larger models.",
    4: "Beyond a plain summary, apogee builds on-device embeddings of the page so you can ask questions and get answers grounded in the actual text - not just the first few thousand characters.",
    5: "For video, it reads the transcript, follows the creator's own chapters, skips sponsor segments, and hands you clickable key moments that seek the player straight to the point."
  };

  // --- The summary, as discrete points mapped back to source paragraphs. ---
  var POINTS = [
    { k: 2, b: "Runs entirely on your device - no page contents ever leave your machine.", s: "The model runs locally, so nothing you read is uploaded or logged." },
    { k: 3, b: "Uses WebGPU on Chromium, WebAssembly on Firefox, or your own local Ollama.", s: "It adapts to your hardware: WebGPU, WebAssembly, or a local Ollama." },
    { k: 4, b: "Answers questions with on-device retrieval grounded in the full page.", s: "You can ask questions and get answers grounded in the whole page." },
    { k: 5, b: "For video: chapter-aware key moments with sponsor segments skipped.", s: "For video it surfaces chapter-aware key moments and skips sponsors." }
  ];

  // --- Canned answers for the Ask box (keyword matched, with a fallback). ---
  var QA = [
    { m: /privac|track|data|server|upload|cloud/i, k: 2,
      a: "Nothing. apogee runs the model on your device, so the page you're reading is never uploaded, logged, or used to train anything." },
    { m: /ollama|model|gpu|webgpu|wasm|hardware|run/i, k: 3,
      a: "It runs on WebGPU on Chromium, WebAssembly on Firefox by default, and can use your own local Ollama over 127.0.0.1 for larger models." },
    { m: /video|youtube|sponsor|chapter|timestamp/i, k: 5,
      a: "For video it reads the transcript, follows the creator's chapters, skips sponsor reads, and gives you clickable key moments." }
  ];
  var FALLBACK = { k: 4, a: "apogee answers from on-device embeddings of the whole page, so the reply is grounded in the actual text rather than a guess." };

  /* ---- duotone icon set (fill layer = .f, stroke layer = plain) ---- */
  function duo(body, extra) {
    return '<path class="f" d="' + body + '"/><path d="' + body + '"/>' + (extra || "");
  }
  var ICONS = {
    sparkle: duo(
      "M12 2.6l2.3 6.1 6.1 2.3-6.1 2.3L12 19.4l-2.3-6.1L3.6 11l6.1-2.3z",
      '<path d="M19 3.5v3M20.5 5h-3"/>'
    ),
    search:
      '<circle class="f" cx="11" cy="11" r="7"/><circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-3.6-3.6"/>',
    pencil: duo("M15.5 4.5l4 4L8 20l-4.5 1 1-4.5z", '<path d="M14 6l4 4"/>'),
    clock:
      '<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
    list:
      '<rect class="f" x="3" y="4" width="18" height="16" rx="2.5"/><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h4M7 13h10M7 17h7"/>',
    skip: duo("M6 5l10 7-10 7z", '<path d="M19 5v14"/>'),
    chip:
      '<rect class="f" x="5" y="5" width="14" height="14" rx="2.5"/><rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2"/>',
    bolt: duo("M13 2 4 14h6l-1 8 9-12h-6z"),
    server:
      '<rect class="f" x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="3" width="18" height="7" rx="2"/><rect class="f" x="3" y="14" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    lines:
      '<rect class="f" x="3" y="4" width="18" height="16" rx="2.5"/><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 9h10M7 12h10M7 15h6"/>',
    globe:
      '<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    translate:
      '<rect class="f" x="2.5" y="3.5" width="11.5" height="11.5" rx="2.2"/><rect x="2.5" y="3.5" width="11.5" height="11.5" rx="2.2"/><path d="M5 6.6h6.5M8.2 6.6v1.3c0 2.4-1.4 4.2-3.7 5.1M6.6 9.2c.7 1.7 2 2.9 4.1 3.4"/><path d="M13.2 20.5l3.6-8.2 3.6 8.2M14.8 17.6h4"/>',
    message:
      '<path class="f" d="M4 5h16v11H8l-4 4z"/><path d="M4 5h16v11H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
    contrast:
      '<path class="f" d="M12 3.2a8.8 8.8 0 0 1 0 17.6z"/><circle cx="12" cy="12" r="8.8"/><path d="M12 3.2v17.6"/>',
    keyboard:
      '<rect class="f" x="2" y="6" width="20" height="12" rx="2.5"/><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>',
    cloudoff:
      '<path class="f" d="M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 10.6-.5A3.6 3.6 0 0 1 18 18z"/><path d="M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 9.5-1.6"/><path d="M3 3l18 18"/>',
    eyeoff:
      '<path class="f" d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><path d="M3 3l18 18"/>',
    shield: duo(
      "M12 22s8-3.5 8-9.5V5l-8-3-8 3v7.5C4 18.5 12 22 12 22z",
      '<path d="M9 12l2 2 4-4"/>'
    ),
    archive:
      '<rect class="f" x="3" y="4" width="18" height="4" rx="1.5"/><rect x="3" y="4" width="18" height="4" rx="1.5"/><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/>',
    filetext:
      '<path class="f" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    play:
      '<circle class="f" cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="9"/><path class="f" d="M10 8.5l6 3.5-6 3.5z"/>',
    chat:
      '<path class="f" d="M4 4h16v12H8l-4 4z"/><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h4"/>',
    gitpr:
      '<circle class="f" cx="6" cy="6" r="3"/><circle cx="6" cy="6" r="3"/><circle class="f" cx="18" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v6M18 15V9a3 3 0 0 0-3-3h-2"/><path d="m14 3 3 3-3 3"/>',
    file:
      '<path class="f" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    mail:
      '<rect class="f" x="2" y="4" width="20" height="16" rx="2.5"/><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m3 6.5 9 6.5 9-6.5"/>'
  };

  function initIcons() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-ico]"), function (el) {
      var g = ICONS[el.getAttribute("data-ico")];
      if (g) el.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + g + "</svg>";
    });
  }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var fmt = "bullets";
  var summarized = false;

  function initReveal() {
    // split [data-split] headlines into word spans (with optional accent word)
    Array.prototype.forEach.call(document.querySelectorAll("[data-split]"), function (el) {
      var accent = el.dataset.accent;
      var nodes = Array.prototype.slice.call(el.childNodes);
      el.textContent = "";
      var i = 0;
      nodes.forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === "BR") {
          el.appendChild(document.createElement("br"));
          return;
        }
        node.textContent.split(/(\s+)/).forEach(function (t) {
          if (t === "") return;
          if (/^\s+$/.test(t)) { el.appendChild(document.createTextNode(t)); return; }
          var s = document.createElement("span");
          s.className = accent && t === accent ? "w accent" : "w";
          s.style.setProperty("--wi", i++);
          s.textContent = t;
          el.appendChild(s);
        });
      });
    });

    var targets = document.querySelectorAll(".reveal, [data-split]");
    if (!("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(targets, function (t) { t.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    Array.prototype.forEach.call(targets, function (t) { io.observe(t); });
  }

  function ready() {
    initIcons();
    initTheme();
    initReveal();
    var demo = document.querySelector("#demo");
    if (!demo) return;

    // Render the source article.
    var doc = $("#doc", demo);
    var html = "<h2>The Orbit Story: reading the web without giving it away</h2>";
    Object.keys(PARAS).forEach(function (k) {
      html += '<p data-k="' + k + '">' + PARAS[k] + "</p>";
    });
    doc.innerHTML = html;

    // Wire controls.
    $("#btn-sum", demo).addEventListener("click", summarize);
    $("#btn-ask", demo).addEventListener("click", ask);
    $("#ask", demo).addEventListener("keydown", function (e) {
      if (e.key === "Enter") ask();
    });
    Array.prototype.forEach.call(demo.querySelectorAll(".seg"), function (b) {
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(demo.querySelectorAll(".seg"), function (x) {
          x.classList.remove("on");
        });
        b.classList.add("on");
        fmt = b.dataset.fmt;
        if (summarized) renderSummary();
      });
    });
  }

  /* ---- day / night ---- */
  function initTheme() {
    var root = document.documentElement;
    var saved = null;
    try { saved = localStorage.getItem("apg-theme"); } catch (e) {}
    if (saved) {
      root.setAttribute("data-theme", saved);
    } else if (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches) {
      root.setAttribute("data-theme", "dark");
    }
    Array.prototype.forEach.call(
      document.querySelectorAll("[data-theme-toggle]"),
      function (b) {
        b.addEventListener("click", function () {
          var next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
          root.setAttribute("data-theme", next);
          try { localStorage.setItem("apg-theme", next); } catch (e) {}
        });
      }
    );
  }

  function shimmer(n) {
    var h = "";
    for (var i = 0; i < n; i++) h += '<div class="sk"></div>';
    return h;
  }

  function summarize() {
    var btn = $("#btn-sum");
    var out = $("#sum");
    btn.classList.add("busy");
    btn.querySelector(".label").textContent = "Reading the page…";
    out.hidden = false;
    out.innerHTML =
      '<div class="sum-head">Summary <span class="tag" id="engtag">webgpu · on-device</span></div>' +
      shimmer(4);
    setTimeout(function () {
      summarized = true;
      btn.classList.remove("busy");
      btn.querySelector(".label").textContent = "Summarize this page";
      renderSummary();
    }, 1300);
  }

  function renderSummary() {
    var out = $("#sum");
    var body = "";
    if (fmt === "bullets") {
      body = '<ul class="pts">';
      POINTS.forEach(function (p, i) {
        body += '<li style="--i:' + i + '" data-k="' + p.k + '">' + p.b + "</li>";
      });
      body += "</ul>";
    } else if (fmt === "sentences") {
      body = '<div class="pts sent">';
      POINTS.forEach(function (p, i) {
        body += '<p style="--i:' + i + '" data-k="' + p.k + '">' + p.s + "</p>";
      });
      body += "</div>";
    } else {
      body =
        '<p class="para" style="--i:0">' +
        POINTS.map(function (p) { return p.s; }).join(" ") +
        "</p>";
    }
    out.innerHTML =
      '<div class="sum-head">Summary <span class="tag">webgpu · on-device</span></div>' +
      body +
      '<div class="hint">Click a point to highlight it in the page →</div>';
    Array.prototype.forEach.call(out.querySelectorAll("[data-k]"), function (el) {
      el.addEventListener("click", function () { highlight(el.dataset.k); });
    });
  }

  function highlight(k) {
    var doc = $("#doc");
    Array.prototype.forEach.call(doc.querySelectorAll("p"), function (p) {
      p.classList.remove("hl");
    });
    var target = doc.querySelector('p[data-k="' + k + '"]');
    if (!target) return;
    target.classList.add("hl");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function ask() {
    var input = $("#ask");
    var q = (input.value || "").trim();
    if (!q) return;
    input.value = "";
    var log = $("#chat");
    log.hidden = false;
    var hit = FALLBACK;
    for (var i = 0; i < QA.length; i++) {
      if (QA[i].m.test(q)) { hit = QA[i]; break; }
    }
    var qa = document.createElement("div");
    qa.className = "qa";
    qa.innerHTML =
      '<div class="q">' + escapeHtml(q) + "</div>" +
      '<div class="a"><span class="think"><i></i><i></i><i></i></span></div>';
    log.appendChild(qa);
    log.scrollTop = log.scrollHeight;
    setTimeout(function () {
      qa.querySelector(".a").innerHTML =
        hit.a + ' <button class="cite" data-k="' + hit.k + '">source</button>';
      qa.querySelector(".cite").addEventListener("click", function () {
        highlight(hit.k);
      });
      log.scrollTop = log.scrollHeight;
    }, 1000);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
