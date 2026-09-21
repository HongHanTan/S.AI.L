/* Shipping Document Verification — front end.
   One page, four sections, hash routing so every email is linkable.

   The Inbox is a master/detail: picking an email opens its report beside the
   queue instead of sending you to a separate screen that is blank until you
   have chosen something. The old Report and Evidence screens live on as tabs
   inside that detail pane. */

const state = {
  emails: [],       // queue rows, as returned by /api/emails
  stats: null,      // /api/stats
  details: {},      // email_id -> /api/emails/{id}, cached
  selected: null,
  tab: "report",    // "report" | "evidence"
  mode: "list",     // "list" | "board" - two views of the same queue
  filter: "ALL",
  query: "",
};

const NON_COMPARISON = "not compared";

// How each decision layer is described in plain words.
// `gate1` covers two cases, so its note is chosen per verdict in evidenceTable.
const LAYERS = {
  gate1:    { name: "numeric gate", note: "compared as a number, never sent to a model" },
  L1:       { name: "canonicalize", note: "identical once case and legal suffixes are normalised" },
  L2:       { name: "alias",        note: "a past human decision already settled this pair" },
  L3:       { name: "similarity",   note: "token-set ratio outside the gray band" },
  L4:       { name: "model",        note: "escalated to Gemini for adjudication" },
  resolver: { name: "resolver",     note: "fallback when the model was itself uncertain" },
};

const REVIEW_REASONS = {
  wrong_doc_type:     "The attachments are not an SI and a draft BL.",
  missing_attachment: "The email did not carry both documents.",
  unreadable:         "A document could not be read.",
  missing_value:      "A required field was absent from a document.",
};

const CHART_COLORS = ["#5d5fef", "#0ea871", "#e8a33d", "#e5486a", "#8b8fd9", "#b9bcce"];

/* ------------------------------------------------------------------ utils */

const el = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/** Long party values arrive as one string of "; "-joined address lines.
 *  Stacking them makes two addresses actually comparable by eye. */
function segments(value) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  return text.split(/\s*;\s*/).filter(Boolean);
}

/** Highlight only the part of two values that actually differs, by trimming
 *  the shared head and tail. Reading a 120-character address is the slowest
 *  step in this job; this is what makes a discrepancy jump out. */
function markDiff(value, other) {
  const a = String(value ?? "");
  const b = String(other ?? "");
  if (!a) return "";
  if (a === b) return esc(a);

  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head &&
         a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const middle = a.slice(head, a.length - tail);
  if (!middle) return esc(a);
  return `${esc(a.slice(0, head))}<mark>${esc(middle)}</mark>${esc(a.slice(a.length - tail))}`;
}

function valueCell(value, other, differs) {
  const parts = segments(value);
  if (!parts.length) return `<span class="absent">&mdash; not present &mdash;</span>`;
  const otherParts = segments(other);
  return parts
    .map((part, i) => `<span class="seg">${differs ? markDiff(part, otherParts[i] ?? "") : esc(part)}</span>`)
    .join("");
}

function layerChip(layer, similarity) {
  const score = similarity == null ? "" :
    ` <span class="faint mono" style="font-size:10px">${similarity.toFixed(2)}</span>`;
  return `<span class="chip chip-layer" data-layer="${esc(layer)}">${esc(layer)}</span>${score}`;
}

function statusPill(rec) {
  if (rec.category !== "BL_COMPARISON") {
    return `<span class="pill neutral">${NON_COMPARISON}</span>`;
  }
  return `<span class="pill ${rec.status}">${rec.status}</span>`;
}

function emptyState(icon, title, body) {
  return `<div class="empty">
    <svg><use href="#${icon}"></use></svg>
    <h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
}

/* ---------------------------------------------------------------- routing */

function parseHash() {
  const parts = (location.hash || "#/overview").replace(/^#\/?/, "").split("/").filter(Boolean);
  const view = ["overview", "inbox", "board", "review", "try"].includes(parts[0]) ? parts[0] : "overview";
  return { view, id: parts[1] || null, tab: parts[2] === "evidence" ? "evidence" : "report" };
}

const TITLES = { overview: "Overview", inbox: "Inbox",
                 review: "Review queue", try: "Try an email" };

async function route() {
  let { view, id, tab } = parseHash();
  // #/board is kept as a link target, but it is the Inbox in board mode -
  // not a second destination for the same queue.
  if (view === "board") { state.mode = "board"; view = "inbox"; id = null; }
  // A link to one email means the list, which is the only mode with a detail
  // pane. Without this, #/inbox/<id> silently renders the lanes instead.
  if (view === "inbox" && id) state.mode = "list";
  state.selected = id;
  state.tab = tab;

  document.querySelectorAll(".view").forEach((n) => { n.hidden = n.id !== `view-${view}`; });
  document.querySelectorAll(".nav-item").forEach((n) => {
    if (n.dataset.view === view) n.setAttribute("aria-current", "page");
    else n.removeAttribute("aria-current");
  });

  el("page-title").textContent = TITLES[view];
  el("search-wrap").hidden = view !== "inbox";
  document.body.classList.toggle("detail-open", view === "inbox" && Boolean(id));
  document.body.classList.remove("rail-open");
  el("rail-scrim").hidden = true;

  if (view === "overview") await renderOverview();
  if (view === "inbox")    await renderInbox();
  if (view === "review")   await renderReview();
  if (view === "try")      renderTry();
}

/* --------------------------------------------------------------- overview */

function donut(entries, total) {
  const R = 54, C = 2 * Math.PI * R;
  let offset = 0;
  const rings = entries.map(([, value], i) => {
    const length = total ? (value / total) * C : 0;
    const ring = `<circle cx="65" cy="65" r="${R}" stroke="${CHART_COLORS[i % CHART_COLORS.length]}"
      stroke-dasharray="${length.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"></circle>`;
    offset += length;
    return ring;
  }).join("");

  return `<svg class="donut" viewBox="0 0 130 130" role="img" aria-label="Decision layer split">
    <g transform="rotate(-90 65 65)" fill="none" stroke-width="16">${rings}</g>
    <text x="65" y="62" text-anchor="middle" font-size="19" font-weight="700"
      fill="#1b1d2a" font-family="Poppins">${total.toLocaleString()}</text>
    <text x="65" y="77" text-anchor="middle" font-size="9" fill="#7a7f9a" font-family="Inter">fields</text>
  </svg>`;
}

function histogram(buckets) {
  const max = Math.max(...buckets, 1);
  const W = 300, H = 118, base = 96;
  const bars = buckets.map((count, i) => {
    const height = count ? Math.max(3, (count / max) * (base - 14)) : 0;
    const x = i * (W / 10) + 3;
    const width = W / 10 - 6;
    // Below 0.72 is DIFFERENT, above 0.92 is SAME, between is the gray band.
    const color = i < 7 ? "#e5486a" : i >= 9 ? "#0ea871" : "#e8a33d";
    return count
      ? `<rect x="${x}" y="${base - height}" width="${width}" height="${height}" rx="2" fill="${color}"></rect>`
      : "";
  }).join("");

  return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Distribution of similarity scores">
    <rect x="${0.72 * W}" y="6" width="${0.2 * W}" height="${base - 6}" fill="#e8a33d" opacity=".10"></rect>
    <line x1="${0.72 * W}" y1="6" x2="${0.72 * W}" y2="${base}" stroke="#e8a33d" stroke-dasharray="3 3"></line>
    <line x1="${0.92 * W}" y1="6" x2="${0.92 * W}" y2="${base}" stroke="#e8a33d" stroke-dasharray="3 3"></line>
    <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="#edeef5"></line>
    ${bars}
    <text x="2"           y="${base + 16}" font-size="9" fill="#7a7f9a" font-family="JetBrains Mono">0.0</text>
    <text x="${0.72 * W}" y="${base + 16}" font-size="9" fill="#e8a33d" font-family="JetBrains Mono" text-anchor="middle">0.72</text>
    <text x="${W - 2}"    y="${base + 16}" font-size="9" fill="#e8a33d" font-family="JetBrains Mono" text-anchor="end">0.92</text>
  </svg>`;
}

async function renderOverview() {
  const target = el("view-overview");
  if (!state.stats) {
    target.innerHTML = `<div class="card"><div class="skeleton" style="height:180px"></div></div>`;
    state.stats = await api("/api/stats");
  }
  const s = state.stats;

  const comparisons = Object.values(s.comparison_statuses).reduce((a, b) => a + b, 0);
  const mismatch = s.comparison_statuses.MISMATCH || 0;
  const review = s.comparison_statuses.NEEDS_REVIEW || 0;
  const ok = s.comparison_statuses.OK || 0;
  const benchmark = s.benchmark || {};

  const benchmarkMetrics = [
    ["Overall score", `${((benchmark.overall_score || 0) * 100).toFixed(2)}%`,
      "weighted final benchmark"],
    ["Defect detection", `${((benchmark.end_to_end_defect_rate || 0) * 100).toFixed(1)}%`,
      `${benchmark.defects_caught || 0} of ${benchmark.defects_total || 0} caught`],
    ["Defect F1", `${((benchmark.stage3_defect_f1 || 0) * 100).toFixed(1)}%`,
      `${((benchmark.defect_precision || 0) * 100).toFixed(0)}% precision`],
    ["Classification F1", `${((benchmark.classification_macro_f1 || 0) * 100).toFixed(1)}%`,
      "macro average across 5 classes"],
    ["Reliability", `${((benchmark.reliability || 0) * 100).toFixed(1)}%`,
      `${((benchmark.escalation_precision || 0) * 100).toFixed(0)}% escalation precision`],
  ];

  const benchmarkStrip = `
    <section class="benchmark" aria-labelledby="benchmark-title">
      <div class="benchmark-head">
        <div>
          <h3 id="benchmark-title">${esc(benchmark.dataset || "Averis Monash Hackathon Dataset")}:</h3>
          <p>Held-out evaluation · accuracy, reliability and safety metrics</p>
        </div>
        <span class="benchmark-tag">Verified benchmark</span>
      </div>
      <div class="benchmark-metrics">
        ${benchmarkMetrics.map(([label, value, detail]) => label === "Defect detection" ? `
          <button type="button" class="benchmark-metric benchmark-metric-action"
              id="defect-detection-card" aria-haspopup="dialog" aria-controls="defect-dialog">
            <span>${esc(label)} <i aria-hidden="true">View missed case &rarr;</i></span>
            <b class="num">${esc(value)}</b>
            <small>${esc(detail)}</small>
          </button>` : `
          <div class="benchmark-metric">
            <span>${esc(label)}</span>
            <b class="num">${esc(value)}</b>
            <small>${esc(detail)}</small>
          </div>`).join("")}
      </div>
    </section>`;

  const tiles = `
    <div class="tiles">
      <div class="tile tile-accent">
        <span class="tile-ico"><svg class="ico" viewBox="0 0 24 24"><use href="#i-mail"></use></svg></span>
        <b class="num">${s.total}</b><span>Emails classified</span><small>the whole inbox</small>
      </div>
      <div class="tile tile-ok">
        <span class="tile-ico"><svg class="ico" viewBox="0 0 24 24"><use href="#i-files"></use></svg></span>
        <b class="num">${comparisons}</b><span>Document checks</span>
        <small>${pct(comparisons, s.total)}% of the inbox</small>
      </div>
      <div class="tile tile-bad">
        <span class="tile-ico"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg></span>
        <b class="num">${mismatch}</b><span>Mismatches found</span>
        <small>${pct(mismatch, comparisons)}% of checks</small>
      </div>
      <div class="tile tile-warn">
        <span class="tile-ico"><svg class="ico" viewBox="0 0 24 24"><use href="#i-hand"></use></svg></span>
        <b class="num">${review}</b><span>Needs a human</span>
        <small>${pct(review, comparisons)}% of checks</small>
      </div>
    </div>`;

  // Defects by field, biggest first, always showing all seven.
  const defects = s.fields
    .map((name) => [name, s.defects[name] || 0])
    .sort((a, b) => b[1] - a[1]);
  const defectMax = Math.max(...defects.map(([, v]) => v), 1);
  const defectBars = defects.map(([name, value], i) => `
    <div class="bar-row">
      <span class="name">${esc(name)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(value / defectMax) * 100}%;
        background:${CHART_COLORS[i % CHART_COLORS.length]}"></span></span>
      <span class="val">${value}</span>
    </div>`).join("");

  const layers = Object.entries(s.layers).sort((a, b) => b[1] - a[1]);
  const fieldsChecked = s.fields_checked || 0;
  const legend = layers.map(([key, value], i) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${CHART_COLORS[i % CHART_COLORS.length]}"></span>
      <span class="k">${esc(key)}</span>
      <span class="d">${esc((LAYERS[key] || {}).name || "")}</span>
      <span class="v num">${value.toLocaleString()}</span>
    </div>`).join("");

  const unusedLayers = Object.keys(LAYERS).filter((k) => !(k in s.layers));

  target.innerHTML = `
    <div class="card">
      <div class="card-head">
        <div><h2>Pipeline summary</h2><p>One full run over ${s.total} emails</p></div>
        <a class="btn btn-ghost btn-sm spacer" href="#/inbox">Open the inbox
          <svg class="ico" viewBox="0 0 24 24"><use href="#i-chevron"></use></svg></a>
      </div>
      ${tiles}
      ${benchmarkStrip}
    </div>

    <div class="grid grid-3" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><div><h2>Defects by field</h2>
          <p>Which of the seven fields actually go wrong</p></div></div>
        <div class="bars">${defectBars}</div>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Decision layers</h2>
          <p>Where each of the ${fieldsChecked.toLocaleString()} field checks was settled</p></div></div>
        <div class="donut-wrap">
          ${donut(layers, fieldsChecked)}
          <div class="legend">${legend}</div>
        </div>
        ${unusedLayers.length ? `<p class="note" style="margin-top:16px">
          Never fired on this run: ${unusedLayers.map((k) => `<code>${esc(k)}</code>`).join(", ")}.</p>` : ""}
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Outcome of each check</h2>
          <p>Across the ${comparisons} document checks</p></div></div>
        <div class="stack">
          <span style="width:${pct(ok, comparisons)}%;background:var(--ok)"></span>
          <span style="width:${pct(mismatch, comparisons)}%;background:var(--bad)"></span>
          <span style="width:${pct(review, comparisons)}%;background:var(--warn)"></span>
        </div>
        <div class="outcomes">
          <div class="outcome"><span class="legend-dot" style="background:var(--ok)"></span>
            <div><div class="t">All seven fields matched</div><div class="s">OK</div></div>
            <div class="r"><b style="color:var(--ok)" class="num">${ok}</b>
              <small>${pct(ok, comparisons)}%</small></div></div>
          <div class="outcome"><span class="legend-dot" style="background:var(--bad)"></span>
            <div><div class="t">At least one field differs</div><div class="s">MISMATCH</div></div>
            <div class="r"><b style="color:var(--bad)" class="num">${mismatch}</b>
              <small>${pct(mismatch, comparisons)}%</small></div></div>
          <div class="outcome"><span class="legend-dot" style="background:var(--warn)"></span>
            <div><div class="t">Sent to a human</div><div class="s">NEEDS_REVIEW</div></div>
            <div class="r"><b style="color:var(--warn)" class="num">${review}</b>
              <small>${pct(review, comparisons)}%</small></div></div>
        </div>
      </div>
    </div>

    <div class="grid split" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><div><h2>Similarity scores</h2>
          <p>Token-set ratio, with the L3 decision thresholds marked</p></div></div>
        ${histogram(s.similarity)}
        <p class="note" style="margin-top:14px">
          Scores sit at the extremes. Nothing landed in the shaded band between
          0.72 and 0.92, which is the only thing that escalates to the model &mdash;
          so <code>L4</code> was never called on this run.</p>
      </div>

      <div class="card">
        <div class="card-head"><div><h2>Why a check needed a human</h2>
          <p>${review} of ${comparisons} checks stopped before a verdict</p></div></div>
        <div class="bars">
          ${Object.entries(s.review_reasons).sort((a, b) => b[1] - a[1]).map(([reason, value]) => `
            <div class="bar-row">
              <span class="name" style="width:160px">${esc(reason)}</span>
              <span class="bar-track"><span class="bar-fill" style="width:${(value / Math.max(...Object.values(s.review_reasons), 1)) * 100}%;background:var(--warn)"></span></span>
              <span class="val" style="background:var(--warn-soft);color:var(--warn)">${value}</span>
            </div>`).join("")}
        </div>
        <p class="note" style="margin-top:16px">Every one of these is a document
          problem, not a disagreement about a value. They are triaged in the
          <a href="#/review" style="color:var(--accent);font-weight:600">Review queue</a>.</p>
      </div>
    </div>`;

  el("defect-detection-card")?.addEventListener("click", openDefectDialog);
}

/** Explain the sole false negative as a visual failure chain. The benchmark
 *  endpoint exposes aggregate counts only, so the source lines are explicitly
 *  presented as a reconstruction based on email_407's saved extraction trace. */
function openDefectDialog() {
  const dlg = el("defect-dialog");
  const host = el("defect-dialog-body");
  wireDefectDialogDismissal();

  host.innerHTML = `
    <header class="failure-head">
      <div>
        <div class="failure-kicker"><span>Missed defect</span>
          <code>email_407</code> <em>Failure reconstruction</em></div>
        <h2 id="defect-dialog-title">Why the 46th defect was missed</h2>
        <p>Shipment <code>5RUS-74951</code> &middot; Shipping Instruction PDF vs draft Bill of Lading PDF</p>
      </div>
      <button class="icon-btn" id="defect-dialog-close" aria-label="Close">&times;</button>
    </header>

    <div class="failure-result">
      <span class="failure-result-icon"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg></span>
      <div><b>The system returned <code>OK</code>, but the notify-party details contained a defect.</b>
        <p>Both incomplete extractions looked identical, so the comparison confidently returned <code>SAME</code>.</p></div>
    </div>

    <div class="failure-flow" aria-label="How the defect was missed">
      <section class="failure-step source-step">
        <div class="step-label"><b>1</b><span>Unusual PDF layout</span></div>
        <div class="paper-mock">
          <div class="paper-top"><span>DRAFT BILL OF LADING</span><small>Page 1</small></div>
          <div class="pdf-field">
            <span class="pdf-label">NOTIFY PARTY</span>
            <strong>NAGAPPA EXPORTS</strong>
          </div>
          <div class="orphan-line">
            <span class="orphan-tag">unlabelled continuation</span>
            <strong>NEW NO: <mark>32</mark>, L-BLOCK, 17TH STREET</strong>
            <span>ANNA NAGAR EAST, CHENNAI 600102</span>
          </div>
        </div>
        <p>The address continued in a separate, unlabelled text block. The changed street number sat outside the field boundary.</p>
      </section>

      <span class="flow-arrow" aria-hidden="true">&rarr;</span>

      <section class="failure-step capture-step">
        <div class="step-label"><b>2</b><span>Incomplete extraction</span></div>
        <div class="capture-box">
          <span>SI captured</span><strong>NAGAPPA EXPORTS</strong>
          <span>BL captured</span><strong>NAGAPPA EXPORTS</strong>
        </div>
        <div class="missing-callout"><span>&times;</span><p><b>Continuation lost</b><br>The address line was never passed to comparison.</p></div>
      </section>

      <span class="flow-arrow" aria-hidden="true">&rarr;</span>

      <section class="failure-step decision-step">
        <div class="step-label"><b>3</b><span>Incorrect decision</span></div>
        <div class="false-ok"><span>System result</span><strong>OK</strong>
          <code>NAGAPPA EXPORTS = NAGAPPA EXPORTS</code></div>
        <div class="actual-result"><span>Actual result</span><strong>DEFECT</strong>
          <small>Notify-party address differs</small></div>
      </section>
    </div>

    <section class="future-fix">
      <div class="future-fix-title"><span>Next upgrade</span><h3>Layout-aware OCR closes this gap</h3></div>
      <div class="future-fix-items">
        <div><b>01</b><span><strong>Follow field geometry</strong><small>Join nearby continuation blocks by position.</small></span></div>
        <div><b>02</b><span><strong>Measure confidence</strong><small>Escalate incomplete or low-confidence fields.</small></span></div>
        <div><b>03</b><span><strong>Highlight the source</strong><small>Show exactly which PDF region produced each value.</small></span></div>
      </div>
    </section>

    <footer class="failure-foot">
      <p><strong>Evidence note:</strong> the benchmark reports aggregate results only. This view reconstructs the failure mode from the saved <code>email_407</code> extraction trace.</p>
      <div>
        <button type="button" class="btn btn-ghost btn-sm" id="defect-dialog-done">Close</button>
        <a class="btn btn-primary btn-sm" id="defect-open-email" href="#/inbox/email_407/evidence">Open email_407</a>
      </div>
    </footer>`;

  dlg.showModal();
  el("defect-dialog-close").addEventListener("click", () => dlg.close());
  el("defect-dialog-done").addEventListener("click", () => dlg.close());
  el("defect-open-email").addEventListener("click", () => {
    state.mode = "list";
    dlg.close();
  });
}

function wireDefectDialogDismissal() {
  const dlg = el("defect-dialog");
  if (!dlg || dlg.dataset.wired) return;
  dlg.dataset.wired = "1";
  dlg.addEventListener("click", (event) => {
    const box = dlg.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top || event.clientY > box.bottom;
    if (outside) dlg.close();
  });
}

/* ------------------------------------------------------------------ inbox */

function matchesFilter(rec) {
  if (state.filter === "ALL") return true;
  // Only comparison mail carries a meaningful status: everything else is
  // "OK" merely because nothing was checked.
  return rec.category === "BL_COMPARISON" && rec.status === state.filter;
}

function matchesQuery(rec) {
  if (!state.query) return true;
  const q = state.query.toLowerCase();
  return rec.email_id.toLowerCase().includes(q) ||
         (rec.subject || "").toLowerCase().includes(q) ||
         (rec.from || "").toLowerCase().includes(q);
}

function queueRows() {
  return state.emails.filter((rec) => matchesFilter(rec) && matchesQuery(rec));
}

/* The filter answers "what needs my attention" only. The category axis — what
   kind of mail this is — used to sit here as four more chips, which mixed two
   unrelated questions into one row and duplicated what the board already shows
   far better. Board mode answers it now, and this one filter drives both
   modes, so narrowing to Mismatch and switching view keeps the narrowing. */
/* Two presentations of one control. The board has room above five lanes for a
   segmented group with lit status markers; the list view puts the same control
   in a narrow column beside the detail pane, where the markers and the longer
   wording push it onto a second row. Same keys, same handler, same state. */
function filterBar(mode) {
  const s = state.stats || { comparison_statuses: {} };
  const board = mode === "board";
  const options = [
    ["ALL", "All", state.emails.length, ""],
    ["MISMATCH", board ? "Mismatch found" : "Mismatch", s.comparison_statuses.MISMATCH || 0, "bad"],
    ["NEEDS_REVIEW", "Needs review", s.comparison_statuses.NEEDS_REVIEW || 0, "warn"],
    ["OK", board ? "Cleared" : "Clean", s.comparison_statuses.OK || 0, "ok"],
  ];
  return `<div class="filters${board ? " segmented" : ""}">${options
    .map(([key, label, count, tone]) => `
    <button class="filter" data-filter="${key}" aria-pressed="${state.filter === key}">
      ${board && tone ? `<i class="fdot ${tone}" aria-hidden="true"></i>` : ""}
      ${esc(label)}<em class="num">${count}</em></button>`).join("")}</div>`;
}

/* List or board: two presentations of one queue, so this is a control on the
   page rather than a second destination in the sidebar. */
function modeToggle() {
  const modes = [["list", "List", "i-inbox"], ["board", "Board", "i-board"]];
  return `<div class="mode-toggle" role="group" aria-label="Queue layout">
    ${modes.map(([key, label, icon]) => `
      <button class="mode" data-mode="${key}" aria-pressed="${state.mode === key}">
        <svg class="ico" viewBox="0 0 24 24"><use href="#${icon}"></use></svg>${label}
      </button>`).join("")}
  </div>`;
}

async function renderInbox() {
  const target = el("view-inbox");
  if (!state.emails.length) {
    target.innerHTML = `<div class="grid split">
      <div class="card"><div class="skeleton" style="height:340px"></div></div>
      <div class="card"><div class="skeleton" style="height:340px"></div></div></div>`;
    const [emails, stats] = await Promise.all([
      api("/api/emails"),
      state.stats ? Promise.resolve(state.stats) : api("/api/stats"),
    ]);
    state.emails = emails;
    state.stats = stats;
    el("count-inbox").textContent = emails.length;
    el("count-review").textContent = stats.comparison_statuses.NEEDS_REVIEW || "";
  }

  const rows = queueRows();
  const list = rows.length ? rows.map((rec) => `
    <button class="queue-row ${rec.category === "BL_COMPARISON" ? "" : "dim"}"
            data-id="${esc(rec.email_id)}"
            aria-current="${state.selected === rec.email_id}">
      <span class="body">
        <span class="line-1">
          <span class="id">${esc(rec.email_id)}</span>
          <span class="chip">${esc(rec.category)}</span>
        </span>
        <span class="subject">${esc(rec.subject) || "(no subject)"}</span>
      </span>
      ${statusPill(rec)}
    </button>`).join("")
    : emptyState("i-search", "Nothing matches",
        "No email matches this filter and search. Try clearing the search box.");

  const controls = `
    <div class="queue-controls">
      <div style="flex:1;min-width:0">${filterBar(state.mode)}</div>
      ${modeToggle()}
    </div>`;

  if (state.mode === "board") {
    target.innerHTML = `
      <div class="card">
        <div class="card-head">
          <div><h2>Queue by category</h2>
            <p>${rows.length} of ${state.emails.length} emails, grouped by what the
            classifier decided each one is</p></div>
        </div>
        ${controls}
        ${boardLanes(rows)}
      </div>`;
    wireQueueControls(target);
    return;
  }

  target.innerHTML = `
    <div class="grid split">
      <div class="card" id="pane-queue">
        <div class="card-head">
          <div><h2>Queue</h2><p>${rows.length} of ${state.emails.length} emails</p></div>
        </div>
        ${controls}
        <div class="queue" id="queue" role="list">${list}</div>
      </div>
      <div class="card" id="pane-detail">
        ${state.selected ? `<div class="skeleton" style="height:320px"></div>`
          : emptyState("i-inbox", "Pick an email",
              "Choose anything in the queue to see its seven-field verdict and the trace behind it.")}
      </div>
    </div>`;

  wireQueueControls(target);

  const queue = el("queue");
  queue.querySelectorAll(".queue-row").forEach((row) => {
    row.addEventListener("click", () => { location.hash = `#/inbox/${row.dataset.id}`; });
    row.addEventListener("keydown", (event) => {
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      const all = [...queue.querySelectorAll(".queue-row")];
      const next = all[all.indexOf(row) + step];
      if (next) { next.focus(); location.hash = `#/inbox/${next.dataset.id}`; }
    });
  });

  // Arriving from the board can land on a row far down a 520-row queue, so the
  // selection is brought into view rather than left for the reader to hunt.
  const current = queue.querySelector('.queue-row[aria-current="true"]');
  if (current) current.scrollIntoView({ block: "nearest" });

  if (state.selected) await renderDetail();
}

function verdictTable(detail) {
  const rows = (detail.verdicts || []).map((v) => {
    const differs = v.verdict === "DIFFERENT";
    const missing = v.verdict === "MISSING";
    return `<tr class="${differs ? "row-diff" : missing ? "row-missing" : ""}">
      <td class="field">${esc(v.field_name)}</td>
      <td class="value">${valueCell(v.si_value, v.bl_value, differs)}</td>
      <td class="value">${valueCell(v.bl_value, v.si_value, differs)}</td>
      <td class="verdict">${esc(v.verdict)}</td>
      <td class="decided">${layerChip(v.decided_by, v.similarity)}</td>
    </tr>`;
  }).join("");

  if (!rows) return "";
  return `<div class="table-wrap"><table>
    <thead><tr><th>Field</th><th>Shipping Instruction</th><th>Draft Bill of Lading</th>
    <th>Verdict</th><th style="text-align:right">Settled by</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

/** The alias-learning loop, offered where the evidence already is.
 *  Only a DIFFERENT verdict on a text field is a judgement call — a numeric
 *  field settled at the gate is a number that does not match, and no human
 *  opinion makes 6 containers equal 3. */
function adjudicator(detail) {
  const fields = (detail.verdicts || [])
    .filter((v) => v.verdict === "DIFFERENT" && v.decided_by !== "gate1");
  if (!fields.length) return "";

  return `<div class="card" style="box-shadow:none;background:var(--canvas);margin-top:22px;padding:18px">
    <span class="eyebrow">Is this really a discrepancy?</span>
    <p class="note" style="background:none;padding:0;margin:8px 0 0">
      If these name the same party written two ways, say so once and the pair is
      settled at <code>L2</code> from then on &mdash; for every future email, without
      a model call.</p>
    ${fields.map((v) => `
      <div class="review-field" data-field="${esc(v.field_name)}" data-id="${esc(detail.email_id)}">
        <span class="fname">${esc(v.field_name)}</span>
        <div class="review-values">
          <div><span class="eyebrow">Shipping Instruction</span>
            <p>${segments(v.si_value).map(esc).join("<br>") || "<span class='absent'>not present</span>"}</p></div>
          <div><span class="eyebrow">Draft Bill of Lading</span>
            <p>${segments(v.bl_value).map(esc).join("<br>") || "<span class='absent'>not present</span>"}</p></div>
        </div>
        <div class="btn-row" style="margin-top:0">
          <button class="btn btn-ok btn-sm" data-verdict="SAME">Same party</button>
          <button class="btn btn-bad btn-sm" data-verdict="DIFFERENT">Genuinely different</button>
        </div>
      </div>`).join("")}
  </div>`;
}

/** Wire up any adjudication buttons inside `root`. Shared by the inbox detail
 *  and the review queue so both behave identically. */
function bindAdjudication(root) {
  root.querySelectorAll(".review-field button").forEach((button) =>
    button.addEventListener("click", async () => {
      const block = button.closest(".review-field");
      block.querySelectorAll("button").forEach((b) => { b.disabled = true; });
      try {
        await api(`/api/review/${encodeURIComponent(block.dataset.id)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field: block.dataset.field, verdict: button.dataset.verdict }),
        });
        block.querySelector(".btn-row").outerHTML =
          `<div class="banner OK" style="margin-top:0"><svg class="ico" viewBox="0 0 24 24"><use href="#i-check"></use></svg>
           <span>Recorded as <b>${esc(button.dataset.verdict)}</b>. It enters the alias
           table at the next promotion.</span></div>`;
      } catch {
        block.querySelectorAll("button").forEach((b) => { b.disabled = false; });
        block.querySelector(".btn-row").insertAdjacentHTML("beforeend",
          `<span class="muted" style="font-size:12px">Could not save. Try again.</span>`);
      }
    }));
}

function ladder(detail) {
  const counts = {};
  (detail.verdicts || []).forEach((v) => { counts[v.decided_by] = (counts[v.decided_by] || 0) + 1; });
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";

  const total = entries.reduce((a, [, v]) => a + v, 0);
  const segs = entries.map(([key, value], i) => `
    <span class="ladder-seg" style="flex:${value};background:${CHART_COLORS[i % CHART_COLORS.length]}">
      ${esc(key)} &times;${value}</span>`).join("");

  const byModel = (counts.L4 || 0) + (counts.resolver || 0);
  return `<div class="ladder">
    <span class="eyebrow">Settled at</span>
    <div class="ladder-bar">${segs}</div>
    <p>${total - byModel} of ${total} fields were settled by deterministic code.
       ${byModel ? `${byModel} reached the model.` : "None reached the model."}</p>
  </div>`;
}

function evidenceTable(detail) {
  const rows = (detail.verdicts || []).map((v) => {
    const layer = LAYERS[v.decided_by] || {};
    // gate1 is reached two different ways: a numeric field compared as an
    // integer, or a value that was absent on one side. Say which one it was.
    const note = v.decided_by === "gate1" && v.verdict === "MISSING"
      ? "a value was absent, so there was nothing to compare"
      : layer.note || "";
    return `<tr class="${v.verdict === "DIFFERENT" ? "row-diff" : ""}">
      <td class="field">${esc(v.field_name)}</td>
      <td class="decided" style="text-align:left">${layerChip(v.decided_by, v.similarity)}</td>
      <td>${esc(layer.name || "")}</td>
      <td class="muted">${esc(v.reason) || esc(note)}</td>
    </tr>`;
  }).join("");

  if (!rows) return "";
  return `<div class="table-wrap"><table>
    <thead><tr><th>Field</th><th>Layer</th><th>Method</th><th>Why it stopped there</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

async function renderDetail() {
  const pane = el("pane-detail");
  const id = state.selected;

  if (!state.details[id]) {
    try {
      state.details[id] = await api(`/api/emails/${encodeURIComponent(id)}`);
    } catch {
      pane.innerHTML = emptyState("i-alert", "Not found", `No email with the id ${id}.`);
      return;
    }
  }
  if (state.selected !== id) return; // a faster click won the race
  const d = state.details[id];

  const isComparison = d.category === "BL_COMPARISON";
  const iconFor = { MISMATCH: "i-alert", NEEDS_REVIEW: "i-hand", OK: "i-check" };

  let banner;
  if (!isComparison) {
    banner = `<div class="banner info"><svg class="ico" viewBox="0 0 24 24"><use href="#i-mail"></use></svg>
      <span>Classified <code>${esc(d.category)}</code>, so no document comparison was run.
      Only <code>BL_COMPARISON</code> mail is checked field by field.</span></div>`;
  } else if (d.status === "MISMATCH") {
    banner = `<div class="banner MISMATCH"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>
      <span>Discrepancy in ${(d.defect_fields || []).map((f) => `<code>${esc(f)}</code>`).join(" and ")}.
      The other fields match.</span></div>`;
  } else if (d.status === "NEEDS_REVIEW") {
    banner = `<div class="banner NEEDS_REVIEW"><svg class="ico" viewBox="0 0 24 24"><use href="#i-hand"></use></svg>
      <span>${esc(REVIEW_REASONS[d.review_reason] || "Sent for review.")}
      Reason code <code>${esc(d.review_reason || "unknown")}</code>.</span></div>`;
  } else {
    banner = `<div class="banner OK"><svg class="ico" viewBox="0 0 24 24"><use href="#i-check"></use></svg>
      <span>All seven fields agree between the Shipping Instruction and the draft Bill of Lading.</span></div>`;
  }

  const notes = (d.notes || []).length
    ? `<div class="notes">${d.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}</div>` : "";

  // The original email, when the inbox is on disk. Brought over from yikkai's
  // ui-redesign branch: seeing the message a customer actually sent, next to
  // the verdict, is what makes the verdict checkable rather than asserted.
  // The API returns nothing when the inbox is absent, as on the deployment.
  const original = d.body
    ? `<details class="original" open>
         <summary>
           <svg class="ico" viewBox="0 0 24 24"><use href="#i-mail"></use></svg>
           Original email
           ${(d.attachment_names || []).length
             ? `<em>${d.attachment_names.length} attachment${d.attachment_names.length === 1 ? "" : "s"}</em>`
             : `<em>no attachments</em>`}
         </summary>
         <pre class="original-body">${esc(d.body)}</pre>
         ${(d.attachment_names || []).length
           ? `<p class="original-files">${d.attachment_names
                .map((n) => `<span class="file-chip"><svg class="ico" viewBox="0 0 24 24"><use href="#i-files"></use></svg>${esc(n)}</span>`)
                .join("")}</p>`
           : ""}
       </details>`
    : "";

  const body = state.tab === "evidence"
    ? (evidenceTable(d) || `<p class="note" style="margin-top:16px">No comparison ran, so there is no trace to show.</p>`)
    : (verdictTable(d) + ladder(d) + adjudicator(d)) ||
      `<p class="note" style="margin-top:16px">No field comparison ran on this email.</p>`;

  pane.innerHTML = `
    <button class="back-link" id="back-to-queue">
      <svg class="ico" viewBox="0 0 24 24"><use href="#i-back"></use></svg> Back to the queue</button>

    <div class="detail-head">
      <span class="detail-ico ${isComparison ? d.status : ""}">
        <svg class="ico" viewBox="0 0 24 24"><use href="#${isComparison ? iconFor[d.status] : "i-mail"}"></use></svg></span>
      <div style="min-width:0">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <code style="font-size:12px;font-weight:600;color:var(--muted)">${esc(d.email_id)}</code>
          ${statusPill(d)}
        </div>
        <h2>${esc(d.subject) || "(no subject)"}</h2>
        <p class="detail-meta">
          <code>${esc(d.from || "unknown sender")}</code> &middot;
          ${d.attachment_count} attachment${d.attachment_count === 1 ? "" : "s"} &middot;
          classified <code>${esc(d.category)}</code>
        </p>
      </div>
    </div>

    ${banner}
    ${notes}${original}

    <div class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="report"
        aria-selected="${state.tab === "report"}">Report</button>
      <button class="tab" role="tab" data-tab="evidence"
        aria-selected="${state.tab === "evidence"}">Evidence</button>
    </div>

    ${body}`;

  pane.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      location.hash = `#/inbox/${id}/${tab.dataset.tab}`;
    }));

  bindAdjudication(pane);

  const back = el("back-to-queue");
  if (back) back.addEventListener("click", () => { location.hash = "#/inbox"; });

  el("queue")?.querySelectorAll(".queue-row").forEach((row) =>
    row.setAttribute("aria-current", String(row.dataset.id === id)));
}

/* ----------------------------------------------------------------- review */

async function renderReview() {
  const target = el("view-review");
  target.innerHTML = `<div class="card"><div class="skeleton" style="height:200px"></div></div>`;
  const queue = await api("/api/review-queue");

  if (!queue.length) {
    target.innerHTML = `<div class="card">${emptyState("i-check", "Nothing waiting",
      "Every document check reached a verdict without needing a human.")}</div>`;
    return;
  }

  // Two very different jobs land in this queue. Splitting them stops the items
  // you can actually decide from being buried under the ones you cannot.
  // Only a DIFFERENT verdict is a judgement call: MISSING means one side has no
  // value at all, so there is no pair of values to call the same or different.
  const adjudicable = [];
  const blocked = [];
  queue.forEach((item) => {
    const fields = (item.verdicts || []).filter((v) => v.verdict === "DIFFERENT");
    (fields.length ? adjudicable : blocked).push({ ...item, fields });
  });

  const blockedByReason = {};
  blocked.forEach((item) => {
    (blockedByReason[item.review_reason || "unknown"] ||= []).push(item);
  });

  target.innerHTML = `
    <div class="card">
      <div class="card-head"><div><h2>Review queue</h2>
        <p>${queue.length} document checks stopped before a verdict</p></div></div>
      <div class="stack" style="margin-top:18px">
        <span style="width:${pct(adjudicable.length, queue.length)}%;background:var(--accent)"></span>
        <span style="width:${pct(blocked.length, queue.length)}%;background:var(--line-2)"></span>
      </div>
      <div class="outcomes" style="margin-top:18px">
        <div class="outcome"><span class="legend-dot" style="background:var(--accent)"></span>
          <div><div class="t">Waiting on your judgement</div>
            <div class="s">a value needs a human decision</div></div>
          <div class="r"><b class="num" style="color:var(--accent)">${adjudicable.length}</b></div></div>
        <div class="outcome"><span class="legend-dot" style="background:var(--line-2)"></span>
          <div><div class="t">Blocked on the documents</div>
            <div class="s">nothing to decide until the file is fixed</div></div>
          <div class="r"><b class="num muted">${blocked.length}</b></div></div>
      </div>
    </div>

    ${adjudicable.length ? `
      <div class="card">
        <div class="card-head"><div><h2>Waiting on your judgement</h2>
          <p>Your answer is stored as an alias, so the same pair is settled at
             <code>L2</code> next time &mdash; without a model call</p></div></div>
      </div>
      ${adjudicable.map((item) => `
        <div class="card">
          <div class="card-head">
            <div><h2 style="font-size:16px">${esc(item.subject) || "(no subject)"}</h2>
              <p><code>${esc(item.email_id)}</code> &middot;
                ${esc(REVIEW_REASONS[item.review_reason] || "Needs a decision.")}</p></div>
            <a class="btn btn-ghost btn-sm spacer" style="white-space:nowrap"
               href="#/inbox/${esc(item.email_id)}">Open in inbox</a>
          </div>
          ${item.fields.map((v) => `
            <div class="review-field" data-field="${esc(v.field_name)}" data-id="${esc(item.email_id)}">
              <span class="fname">${esc(v.field_name)}</span>
              <div class="review-values">
                <div><span class="eyebrow">Shipping Instruction</span>
                  <p>${segments(v.si_value).map(esc).join("<br>") || "<span class='absent'>not present</span>"}</p></div>
                <div><span class="eyebrow">Draft Bill of Lading</span>
                  <p>${segments(v.bl_value).map(esc).join("<br>") || "<span class='absent'>not present</span>"}</p></div>
              </div>
              <div class="btn-row" style="margin-top:0">
                <button class="btn btn-ok btn-sm" data-verdict="SAME">Same party</button>
                <button class="btn btn-bad btn-sm" data-verdict="DIFFERENT">Genuinely different</button>
              </div>
            </div>`).join("")}
        </div>`).join("")}
    ` : ""}

    ${blocked.length ? `
      <div class="card">
        <div class="card-head"><div><h2>Blocked on the documents</h2>
          <p>${blocked.length} checks where there is no value to judge yet</p></div></div>
        ${Object.entries(blockedByReason).sort((a, b) => b[1].length - a[1].length)
          .map(([reason, items]) => `
            <div style="margin-top:20px">
              <span class="eyebrow">${esc(reason)} &middot; ${items.length}</span>
              <p class="note" style="margin-top:8px">${esc(REVIEW_REASONS[reason] ||
                "This check could not be completed automatically.")}</p>
              <div class="queue" style="margin-top:8px">
                ${items.map((item) => `
                  <a class="queue-row" href="#/inbox/${esc(item.email_id)}">
                    <span class="body">
                      <span class="line-1"><span class="id">${esc(item.email_id)}</span></span>
                      <span class="subject">${esc(item.subject) || "(no subject)"}</span>
                    </span>
                    <svg class="ico faint" viewBox="0 0 24 24"><use href="#i-chevron"></use></svg>
                  </a>`).join("")}
              </div>
            </div>`).join("")}
      </div>` : ""}`;

  bindAdjudication(target);
}

/* ---------------------------------------------------------------- try view */

/* An <input type=file> hands back a read-only FileList, so there is no way to
   drop one entry from it. The picked files are kept here instead and the
   upload is built from this array; the input is only ever a source of new
   files, and is emptied after every pick. */
let tryFiles = [];

/* Each inspected document, keyed by filename, so a row can show what the
   document turned out to be and open its extracted text. */
const tryPreviews = new Map();

/* Deleting a file starts a fresh inspection while the previous one may still
   be in flight. Only the newest run is allowed to write its answer back. */
let inspectRun = 0;

const CONTEXT_FIELDS = ["cmp-carrier", "cmp-origin", "cmp-destination",
                        "cmp-shipper", "cmp-consignee"];
const CONTEXT_HINT = "Carrier, route and parties will be extracted from the attachments.";

/** Bytes, at the precision a person reading a file list actually wants. */
function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** What the result pane says before anything has been run, and what Clear
 *  form puts back. Written once so the two cannot drift apart. */
const TRY_PLACEHOLDER = () => emptyState("i-play", "No result yet",
  "Fill in the form and press Process email. The result appears here.");

/** Clear form is live only when there is something to clear, so the control
 *  reports the state of the form before anyone presses it. The context fields
 *  are readonly and only ever filled from the attachments, so tryFiles already
 *  speaks for them. */
function syncClear() {
  const typed = ["cmp-from", "cmp-subject", "cmp-body"].some((id) => el(id).value !== "");
  const ran = !el("cmp-out").querySelector(".empty");
  el("cmp-clear").disabled = !(typed || tryFiles.length > 0 || ran);
}

/** One row per attachment: what it is, how big, its text, and a way to drop it.
 *  The type and Preview arrive later than the row itself, because they come
 *  from /api/inspect - until then the button is present but dead, which says
 *  "reading" more honestly than an absent control would. */
function renderTryFiles() {
  el("cmp-filelist").innerHTML = tryFiles.map((file, i) => {
    const doc = tryPreviews.get(file.name);
    const kind = doc ? (doc.detected_type || doc.format || "").toUpperCase() : "";
    return `
    <li class="file-row">
      <svg class="ico faint" viewBox="0 0 24 24"><use href="#i-files"></use></svg>
      <span class="file-name">${esc(file.name)}</span>
      ${kind ? `<span class="file-kind mono">${esc(kind)}</span>` : ""}
      <span class="file-size mono num">${fileSize(file.size)}</span>
      <button class="btn btn-ghost btn-sm file-prev" type="button"
              data-file="${esc(file.name)}" ${doc ? "" : "disabled"}
              title="${doc ? "Show the text read from this attachment"
                           : "Still reading this attachment"}">Preview</button>
      <button class="file-del" type="button" data-i="${i}"
              title="Remove ${esc(file.name)}" aria-label="Remove ${esc(file.name)}">
        <svg class="ico" viewBox="0 0 24 24"><use href="#i-trash"></use></svg>
      </button>
    </li>`;
  }).join("");

  el("cmp-count").textContent = tryFiles.length
    ? `${tryFiles.length} file${tryFiles.length === 1 ? "" : "s"} attached`
    : "";
  syncClear();
}

function renderTry() {
  const target = el("view-try");
  if (target.dataset.ready) return;
  target.dataset.ready = "1";

  target.innerHTML = `
    <div class="grid split">
      <div class="card">
        <div class="card-head"><div><h2>Try an email</h2>
          <p>Runs the real pipeline, not a mock</p></div></div>

        <p class="note" style="margin-top:14px">Write an email the way a customer
          would and attach whatever documents it would carry &mdash; or none. This runs
          classification, document typing, extraction, comparison and rollup: the
          same code path the ${state.stats ? state.stats.total : 520}-email batch uses.</p>
        <p class="note">You never say which attachment is the Shipping Instruction
          and which is the draft Bill of Lading. Each document's own header decides,
          because in real inboxes filenames lie.</p>

        <div class="field-group">
          <label for="cmp-from">From</label>
          <input class="input" type="text" id="cmp-from" placeholder="docs@vitalsolutions.sg">
        </div>
        <div class="field-group">
          <label for="cmp-subject">Subject</label>
          <input class="input" type="text" id="cmp-subject"
                 placeholder="TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI">
        </div>
        <div class="field-group">
          <label for="cmp-body">Body</label>
          <textarea class="textarea" id="cmp-body"
            placeholder="Hi,&#10;&#10;Attached are the SI and draft BL. Please check the details and confirm.&#10;&#10;Thanks"></textarea>
        </div>
        <div class="context-grid">
          <div class="field-group"><label for="cmp-carrier">Carrier</label>
            <input class="input auto-input" id="cmp-carrier" readonly placeholder="Auto-detected"></div>
          <div class="field-group"><label for="cmp-origin">Origin country</label>
            <input class="input auto-input mono" id="cmp-origin" readonly placeholder="Auto"></div>
          <div class="field-group"><label for="cmp-destination">Destination country</label>
            <input class="input auto-input mono" id="cmp-destination" readonly placeholder="Auto"></div>
        </div>
        <div class="party-grid">
          <div class="field-group"><label for="cmp-shipper">Shipper</label>
            <textarea class="textarea auto-input party-input" id="cmp-shipper" readonly
              placeholder="Auto-detected from SI"></textarea></div>
          <div class="field-group"><label for="cmp-consignee">Consignee</label>
            <textarea class="textarea auto-input party-input" id="cmp-consignee" readonly
              placeholder="Auto-detected from SI"></textarea></div>
        </div>
        <p class="muted" id="cmp-context-msg" style="font-size:12px;margin:7px 0 0">
          Carrier, route and parties will be extracted from the attachments.</p>
        <div class="field-group">
          <label for="cmp-files">Attachments &mdash; optional, any order</label>
          <input type="file" id="cmp-files" class="file-input" multiple>
          <div class="file-pick">
            <button class="btn btn-ghost btn-sm" type="button" id="cmp-pick">
              <svg class="ico" viewBox="0 0 24 24"><use href="#i-files"></use></svg>
              Choose files</button>
            <span class="muted file-count" id="cmp-count" aria-live="polite"></span>
          </div>
          <ul class="filelist" id="cmp-filelist"></ul>
        </div>

        <div class="btn-row">
          <button class="btn" id="cmp-run"><svg class="ico" viewBox="0 0 24 24"><use href="#i-play"></use></svg> Process email</button>
          <button class="btn btn-ghost btn-sm" id="cmp-eg1">Load a document check</button>
          <button class="btn btn-ghost btn-sm" id="cmp-eg2">Load a spam example</button>
          <button class="btn btn-ghost btn-sm btn-danger btn-reset" type="button"
                  id="cmp-clear" disabled>
            <svg class="ico" viewBox="0 0 24 24"><use href="#i-trash"></use></svg>
            Clear form</button>
        </div>
        <p class="muted" id="cmp-msg" style="font-size:12px;margin:10px 0 0"></p>
      </div>

      <div class="card" id="cmp-out">${TRY_PLACEHOLDER()}</div>
    </div>
    <dialog class="attachment-dialog" id="attachment-preview">
      <div class="attachment-dialog-head"><div><h2 id="preview-name">Attachment</h2>
        <p class="muted" id="preview-meta"></p></div>
        <button class="btn btn-ghost btn-sm" id="preview-close">Close</button></div>
      <pre id="preview-text"></pre>
    </dialog>`;

  el("cmp-run").addEventListener("click", runCompare);
  el("cmp-pick").addEventListener("click", () => el("cmp-files").click());
  el("preview-close").addEventListener("click", () => el("attachment-preview").close());

  el("cmp-files").addEventListener("change", () => {
    const input = el("cmp-files");
    for (const file of input.files) {
      // The same name at the same size twice over is a double-pick, not two
      // documents, so it is dropped rather than uploaded twice.
      if (!tryFiles.some((f) => f.name === file.name && f.size === file.size)) {
        tryFiles.push(file);
      }
    }
    input.value = "";   // so picking the same file again still fires change
    renderTryFiles();
    inspectTryAttachments();
  });

  el("cmp-clear").addEventListener("click", () => {
    for (const id of ["cmp-from", "cmp-subject", "cmp-body"]) el(id).value = "";
    for (const id of CONTEXT_FIELDS) el(id).value = "";
    tryFiles = [];
    tryPreviews.clear();
    inspectRun += 1;          // abandon any inspection still in flight
    el("cmp-files").value = "";
    renderTryFiles();
    el("cmp-msg").textContent = "";
    el("cmp-context-msg").textContent = CONTEXT_HINT;
    el("cmp-out").innerHTML = TRY_PLACEHOLDER();
    if (el("attachment-preview").open) el("attachment-preview").close();
    syncClear();
    el("cmp-from").focus();
  });

  for (const id of ["cmp-from", "cmp-subject", "cmp-body"]) {
    el(id).addEventListener("input", syncClear);
  }

  el("cmp-filelist").addEventListener("click", (event) => {
    const preview = event.target.closest(".file-prev");
    if (preview) { openAttachmentPreview(preview.dataset.file); return; }

    const button = event.target.closest(".file-del");
    if (!button) return;
    const index = Number(button.dataset.i);
    tryFiles.splice(index, 1);
    renderTryFiles();
    // Carrier, route and parties were read from the whole set, so dropping one
    // document makes them stale. They are derived again from what is left.
    inspectTryAttachments();
    // That button no longer exists, so focus is handed to the row that moved
    // into its place, or back to the picker once the list is empty.
    const rest = el("cmp-filelist").querySelectorAll(".file-del");
    (rest[Math.min(index, rest.length - 1)] || el("cmp-pick")).focus();
  });

  renderTryFiles();
  syncClear();

  el("cmp-eg1").addEventListener("click", () => {
    el("cmp-from").value = "docs@vitalsolutions.sg";
    el("cmp-subject").value = "TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI_PAKISTAN";
    el("cmp-body").value = [
      "Hi Mitchelle,", "",
      "Attached are the SI and draft BL for OC 5ALT-01226.",
      "Please check the details and confirm.", "",
      "Best Regards,", "Deswita",
    ].join("\n");
    el("cmp-msg").textContent = "Now attach an SI and a BL, then press Process email.";
    syncClear();
  });

  el("cmp-eg2").addEventListener("click", () => {
    el("cmp-from").value = "offers@quick-cargo-deals.biz";
    el("cmp-subject").value = "Increase your shipping revenue with this ONE weird trick";
    el("cmp-body").value = "Click here now to unlock unlimited freight discounts!";
    el("cmp-msg").textContent = "No attachments needed — just press Process email.";
    syncClear();
  });
}

/** Reads the attachments through /api/inspect so the shipment context panel can
 *  be filled and each document's text can be previewed.
 *
 *  It works from tryFiles, not the input's own FileList: once a row has been
 *  deleted the input still holds the original pick, so inspecting that would
 *  describe documents that are no longer attached.
 */
async function inspectTryAttachments() {
  const run = ++inspectRun;
  const files = [...tryFiles];
  const message = el("cmp-context-msg");
  tryPreviews.clear();
  for (const id of CONTEXT_FIELDS) el(id).value = "";
  if (!files.length) {
    message.textContent = CONTEXT_HINT;
    renderTryFiles();
    return;
  }

  message.textContent = "Reading attachments and detecting shipment context…";
  const form = new FormData();
  for (const file of files) form.append("files", file);
  try {
    const response = await fetch("/api/inspect", { method: "POST", body: form });
    const data = await response.json();
    if (run !== inspectRun) return;   // the attachments changed under this run
    if (!response.ok) throw new Error(data.detail || "Attachment inspection failed.");
    const context = data.shipment_context || {};
    const detected = data.detected_fields || {};
    el("cmp-carrier").value = context.carrier || "";
    el("cmp-origin").value = context.origin_country || "";
    el("cmp-destination").value = context.destination_country || "";
    el("cmp-shipper").value = detected.shipper || "";
    el("cmp-consignee").value = detected.consignee || "";
    for (const doc of data.documents || []) tryPreviews.set(doc.filename, doc);
    const route = context.origin_country && context.destination_country
      ? `${context.origin_country} → ${context.destination_country}` : "";
    const found = [context.carrier, route].filter(Boolean).join(" · ");
    message.textContent = found ? `Detected from attachments: ${found}`
      : "No carrier or route could be confidently extracted.";
  } catch (error) {
    if (run !== inspectRun) return;
    message.textContent = error.message;
  }
  // Either way the rows are redrawn: on success they gain their type and a live
  // Preview button; on failure they stay as plain removable rows.
  renderTryFiles();
}

function openAttachmentPreview(filename) {
  const doc = tryPreviews.get(filename);
  if (!doc) return;
  el("preview-name").textContent = filename;
  el("preview-meta").textContent = [doc.format && doc.format.toUpperCase(),
    doc.detected_type || "UNKNOWN", doc.preview_truncated ? "preview truncated" : ""]
    .filter(Boolean).join(" · ");
  el("preview-text").textContent = doc.preview || doc.error || "No extractable text found.";
  el("attachment-preview").showModal();
}

async function runCompare() {
  const message = el("cmp-msg");
  const out = el("cmp-out");
  const subject = el("cmp-subject").value;
  const body = el("cmp-body").value;

  if (!subject.trim() && !body.trim()) {
    message.textContent = "Write a subject or a body first.";
    return;
  }

  const button = el("cmp-run");
  button.disabled = true;
  message.textContent = "Processing…";
  out.innerHTML = `<div class="skeleton" style="height:260px"></div>`;

  const form = new FormData();
  form.append("subject", subject);
  form.append("body", body);
  form.append("sender", el("cmp-from").value);
  for (const file of tryFiles) form.append("files", file);

  try {
    const response = await fetch("/api/try-email", { method: "POST", body: form });
    const d = await response.json();
    if (!response.ok) {
      out.innerHTML = `<div class="banner MISMATCH"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>
        <span>${esc(d.detail || "Processing failed.")}</span></div>`;
      return;
    }
    out.innerHTML = compareResult(d);
  } catch {
    out.innerHTML = `<div class="banner MISMATCH"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>
      <span>Could not reach the server.</span></div>`;
  } finally {
    button.disabled = false;
    message.textContent = "";
    syncClear();
  }
}

function compareResult(d) {
  const roleName = { SI: "Shipping Instruction", BL: "draft Bill of Lading" };
  const roles = (d.documents || []).map((doc) => `
    <li><code>${esc(doc.filename)}</code>
      <svg class="ico faint" viewBox="0 0 24 24"><use href="#i-chevron"></use></svg>
      <span>${esc(roleName[doc.detected_type] || "not a shipping document")}</span></li>`).join("");

  const isComparison = d.category === "BL_COMPARISON";
  const context = d.shipment_context || {};
  const findings = d.compliance_findings || [];
  const compliance = d.compliance_status || "NOT_CHECKED";
  const complianceClass = compliance === "PASS" ? "OK"
    : compliance === "BLOCK" ? "MISMATCH" : "info";
  const complianceRows = findings.map((finding) => `
    <div class="compliance-row ${finding.status === "PASS" ? "pass" : "block"}">
      <div><strong>${esc(finding.status)}</strong> &middot; ${esc(FIELD_LABEL[finding.field] || finding.field)}</div>
      <p>${esc(finding.message)}</p><p class="muted">${esc(finding.action)}</p>
      <a href="${esc(finding.source_url)}" target="_blank" rel="noopener">Published requirement</a>
    </div>`).join("");
  let banner;
  if (!isComparison && d.category) {
    banner = `<div class="banner info"><svg class="ico" viewBox="0 0 24 24"><use href="#i-mail"></use></svg>
      <span>Classified <code>${esc(d.category)}</code>, so no comparison was run.</span></div>`;
  } else if (d.status === "MISMATCH") {
    banner = `<div class="banner MISMATCH"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>
      <span>Discrepancy in ${(d.defect_fields || []).map((f) => `<code>${esc(f)}</code>`).join(" and ")}.</span></div>`;
  } else if (d.status === "NEEDS_REVIEW") {
    banner = `<div class="banner NEEDS_REVIEW"><svg class="ico" viewBox="0 0 24 24"><use href="#i-hand"></use></svg>
      <span>${esc(REVIEW_REASONS[d.review_reason] || "Sent for review.")}</span></div>`;
  } else {
    banner = `<div class="banner OK"><svg class="ico" viewBox="0 0 24 24"><use href="#i-check"></use></svg>
      <span>No mismatch detected.</span></div>`;
  }

  return `
    <div class="card-head"><div><h2>Result</h2>
      <p>Straight out of the pipeline</p></div>
      <span class="spacer">${isComparison && d.status
        ? `<span class="pill ${d.status}">${esc(d.status)}</span>`
        : `<span class="pill neutral">${NON_COMPARISON}</span>`}</span>
    </div>
    ${d.category ? `<p class="detail-meta" style="margin-top:12px">Classified
      <code>${esc(d.category)}</code>${d.classifier && d.classifier !== "gemini"
        ? ` <span class="faint">(${esc(d.classifier)})</span>` : ""}</p>` : ""}
    ${banner}
    ${roles ? `<span class="eyebrow" style="display:block;margin-top:18px">Documents read as</span>
      <ul class="roles">${roles}</ul>` : ""}
    ${(d.notes || []).length ? `<div class="notes">${d.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}</div>` : ""}
    ${isComparison ? `<div class="country-panel">
      <span class="eyebrow">Country compliance</span>
      <div class="banner ${complianceClass}" style="margin-top:8px">
        <span><strong>${esc(compliance)}</strong>${context.carrier ? ` &middot; ${esc(context.carrier)}` : ""}
        ${context.origin_country && context.destination_country
          ? ` &middot; ${esc(context.origin_country)} &rarr; ${esc(context.destination_country)}` : ""}</span></div>
      ${complianceRows || `<p class="note">${compliance === "NOT_APPLICABLE"
        ? "No configured country rule applies to this route."
        : "The carrier or route could not be extracted from the attachments."}</p>`}
    </div>` : ""}
    ${verdictTable(d)}
    ${ladder(d)}`;
}

/* ------------------------------------------------------------------- boot */

el("q").addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  if (parseHash().view === "inbox") renderInbox();
});

el("rail-toggle").addEventListener("click", () => {
  const open = document.body.classList.toggle("rail-open");
  el("rail-toggle").setAttribute("aria-expanded", String(open));
  el("rail-scrim").hidden = !open;
});

el("rail-scrim").addEventListener("click", () => {
  document.body.classList.remove("rail-open");
  el("rail-scrim").hidden = true;
  el("rail-toggle").setAttribute("aria-expanded", "false");
});

window.addEventListener("hashchange", route);

(async function boot() {
  try {
    state.stats = await api("/api/stats");
    el("count-inbox").textContent = state.stats.total;
    el("count-review").textContent = state.stats.comparison_statuses.NEEDS_REVIEW || "";
    el("source-meta").textContent =
      `${state.stats.total} emails · ${state.stats.fields_checked.toLocaleString()} field checks`;
  } catch {
    el("source-meta").textContent = "could not load the run";
  }
  route();
})();


/** Filter chips and the list/board toggle behave the same in both modes. */
function wireQueueControls(target) {
  target.querySelectorAll(".filter").forEach((button) =>
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      renderInbox();
    }));
  target.querySelectorAll(".bcard").forEach((card) =>
    card.addEventListener("click", () => openBoardDialog(card.dataset.open)));
  target.querySelectorAll(".mode").forEach((button) =>
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      // Leaving a selection open would hide behind the board.
      if (state.mode === "board" && state.selected) location.hash = "#/inbox";
      else renderInbox();
    }));
}

/* ------------------------------------------------------------------- board */
/* Category board.
   Ported from yikkai's `ui-redesign` branch onto this dashboard's rendering
   idiom. The lane order, the wording of each blurb, the decision to show the
   category enum verbatim, and the "primary desk" emphasis on BL_COMPARISON are
   all theirs — see the merge parents for the original commits.

   Lanes are named after what the emails *are*, not what to do with them: an
   earlier "Document check" heading made reviewers read cleared tickets sitting
   in the lane as outstanding work. The keys are the category enum from
   src/sdoc/models.py, which is what submission.json is scored on, shown
   verbatim so a lane maps onto an evaluation key with no translation step. */

/* Inlined rather than added to the sprite: the sprite lives in index.html and
   this change is confined to the script and the stylesheet. Each is a filled
   24x24 path in the same idiom as the sprite's own icons, and each takes its
   colour from the lane's --cat, so the icon, the header rule and the count
   badge are all one hue with no second place to keep it in step. */
const LANE_ICONS = {
  // Stacked sheets: one document checked against another.
  BL_COMPARISON: "M12 2 2 7l10 5 10-5-10-5Zm7.8 7.3L12 13.2 4.2 9.3 2 10.4l10 5 "
    + "10-5-2.2-1.1Zm0 4.5L12 17.7l-7.8-3.9L2 14.9l10 5 10-5-2.2-1.1Z",
  // Into the tray: an instruction arriving or being asked for.
  SI_REQUEST: "M11 3h2v6.2l2.3-2.3 1.4 1.4L12 13l-4.7-4.7 1.4-1.4L11 9.2V3Zm-7 11h5.2"
    + "l1.2 2h3.2l1.2-2H20v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z",
  // A receipt, torn edge and all.
  INVOICE_QUERY: "M5 2h14v20l-2.3-1.5-2.3 1.5-2.4-1.5-2.3 1.5L7.3 20.5 5 22V2Zm2 4v2h10V6"
    + "H7Zm0 4v2h10v-2H7Zm0 4v2h7v-2H7Z",
  // Plain correspondence.
  GENERAL: "M3 5h18a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm1 3.2V17"
    + "h16V8.2l-8 5-8-5ZM19.4 7H4.6l7.4 4.6L19.4 7Z",
  // Shield with a warning: caught, not delivered.
  SPAM: "M12 2 4 5.5V11c0 4.6 3.4 8.6 8 9.8 4.6-1.2 8-5.2 8-9.8V5.5L12 2Zm-1 4.5h2v6h-2v-6Z"
    + "m0 7.8h2v2h-2v-2Z",
};

const CATEGORY_LANES = [
  ["BL_COMPARISON",  "Draft checked against instruction"],
  ["SI_REQUEST",     "Shipping instruction sent or requested"],
  ["INVOICE_QUERY",  "Charges, invoices and fees"],
  ["GENERAL",        "Correspondence and operational updates"],
  ["SPAM",           "Promotions and phishing"],
];

const FIELD_LABEL = {
  shipper: "Shipper", consignee: "Consignee", notify_party: "Notify party",
  port_of_loading: "Port of loading", port_of_discharge: "Port of discharge",
  container_count: "Container count", gross_weight_kg: "Gross weight",
};

/** "5RSG-00133" style booking reference, if the subject carries one. */
function bookingRef(subject) {
  const m = String(subject || "").match(/\b\d[A-Z]{3}-\d{5}\b/);
  return m ? m[0] : "";
}

/** Title case from the shouted upper case the subjects arrive in. */
const titleWord = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const titleCase = (text) => text.split(" ").map(titleWord).join(" ");

/** As above, but a short all-caps run in a country is a code rather than a
 *  word: US and UAE are names in their own right and "Us" reads as the
 *  pronoun. The rule is confined to the country half, because in a city the
 *  same run is an ordinary name - Jebel ALI and NEW York, otherwise.
 */
const countryCase = (text) => text.split(" ")
  .map((w) => (/^[A-Z]{2,3}$/.test(w) ? w : titleWord(w))).join(" ");

/** "Callao, Peru" - the route, when the subject names a destination.
 *
 *  The pattern is CITY_COUNTRY, both halves wholly upper case, sitting inside
 *  a subject whose other fields are delimited by " _ " or " - ". Either half
 *  can carry a space (JEBEL ALI, SOUTH KOREA), so both are matched as a small
 *  number of words rather than one run: an unbounded [A-Z ]+ would swallow the
 *  company name that usually follows.
 *
 *  Nothing may sit between the city and the underscore, which is what keeps
 *  "TO CONFIRM DOCS _ ..." from matching - there the underscore is spaced.
 */
function routeOf(subject) {
  const m = String(subject || "")
    .match(/\b([A-Z]+(?: [A-Z]+){0,2})_([A-Z]+(?: [A-Z]+)?)\b/);
  if (!m) return "";
  return `${titleCase(m[1].trim())}, ${countryCase(m[2].trim())}`;
}

/** A subject field that is only the raw CITY_COUNTRY token. */
const ROUTE_TOKEN = /^[A-Z]+(?: [A-Z]+){0,2}_[A-Z]+(?: [A-Z]+)?$/;

/** The subject broken into its delimited fields, with the reply marker, the
 *  booking reference and the raw port token dropped: all three have their own
 *  place on the card now, and repeating them is what made the line unreadable.
 *
 *  Subjects separate fields with " _ " or " - ", so the split is on the spaced
 *  delimiter, and on a trailing "_ " where the leading space was dropped. A
 *  bare underscore is never one: it is what holds CALLAO_PERU together, and
 *  what dates like 15_01_2026 are built from.
 */
function subjectParts(subject, ref) {
  return String(subject || "")
    .replace(/^\s*(?:re|fw|fwd)\s*[:_-]\s*/i, "")
    .split(/\s+[_-]\s+|_\s+|_{2,}/)
    .map((part) => part.replace(/^[\s_]+|[\s_]+$/g, ""))
    .filter(Boolean)
    .filter((part) => !(ref && part.includes(ref)))
    .filter((part) => !ROUTE_TOKEN.test(part));
}

function seqNumber(emailId) {
  const m = String(emailId || "").match(/(\d+)/);
  return m ? m[1] : "";
}

/** What this email amounts to, in one line. */
function boardOutcome(rec) {
  if (rec.category !== "BL_COMPARISON") return { cls: "", text: "" };
  if (rec.status === "MISMATCH") {
    const names = (rec.defect_fields || []).map((f) => FIELD_LABEL[f] || f).join(", ");
    return { cls: "bad", text: `${names} differ` };
  }
  if (rec.status === "NEEDS_REVIEW") {
    return { cls: "warn", text: REVIEW_REASONS[rec.review_reason] || "Needs a person" };
  }
  return { cls: "ok", text: "All 7 fields match" };
}

/* Inlined rather than added to the sprite, because the sprite lives in
   index.html and this change is confined to the script and the stylesheet. */
const CLIP_PATH = "M7 8v8.5a5 5 0 0 0 10 0V6.5a3.5 3.5 0 1 0-7 0V16a2 2 0 1 0 "
  + "4 0V8h-1.5v8a.5.5 0 0 1-1 0V6.5a2 2 0 1 1 4 0V16.5a3.5 3.5 0 1 1-7 0V8H7Z";

/** One card. On the board a card opens a dialog rather than navigating: the
 *  lanes are a survey, and losing your place in them to read one verdict is a
 *  poor trade. */
function boardCard(rec) {
  const ref = bookingRef(rec.subject);
  const route = routeOf(rec.subject);
  const outcome = boardOutcome(rec);
  const count = rec.attachment_count;

  // With a reference the top slot is that reference and the whole remaining
  // subject reads below it. Without one - 194 of the 520, and the payload
  // carries no sender to put there instead - the subject's own first field is
  // promoted into the slot and the rest reads below, so the header is never
  // empty and nothing is said twice.
  const parts = subjectParts(rec.subject, ref);
  const head = ref || parts[0] || "";
  const body = (ref ? parts : parts.slice(1)).join(" \u00b7 ");

  return `<button type="button" class="bcard" data-open="${esc(rec.email_id)}"
             data-status="${esc(rec.status)}">
    <span class="bcard-top">
      ${head ? `<span class="bcard-ref${ref ? " mono" : " text"}">${esc(head)}</span>` : ""}
      <span class="bcard-seq mono">#${esc(seqNumber(rec.email_id))}</span>
    </span>
    ${route ? `<span class="bcard-route">&rarr; ${esc(route)}</span>` : ""}
    ${body ? `<span class="bcard-subject">${esc(body)}</span>` : ""}
    ${outcome.text
      ? `<span class="bcard-outcome ${outcome.cls}">${esc(outcome.text)}</span>`
      : ""}
    ${count ? `<span class="bcard-att"><svg class="clip" viewBox="0 0 24 24"
         aria-hidden="true"><path d="${CLIP_PATH}"/></svg>${count}</span>` : ""}
  </button>`;
}

/** The five lanes, over rows the shared filter has already narrowed.
 *  Pure markup: the queue owns the data and the filtering. */
function boardLanes(rows) {
  const lanes = CATEGORY_LANES.map(([key, blurb]) => {
    const inLane = rows.filter((r) => r.category === key);
    const total = state.emails.filter((r) => r.category === key).length;
    const cards = inLane.length
      ? inLane.map(boardCard).join("")
      : `<p class="lane-empty">Nothing here under this filter.</p>`;
    return `<section class="lane${key === "BL_COMPARISON" ? " key" : ""}" data-cat="${key}">
      <header class="lane-h">
        <h2>
          <span class="lane-name">
            <svg class="lane-i" viewBox="0 0 24 24" aria-hidden="true"
              ><path d="${LANE_ICONS[key]}"/></svg>
            <span class="enum mono">${esc(key)}</span>
            ${key === "BL_COMPARISON" ? `<span class="lane-flag">primary desk</span>` : ""}
          </span>
          <span class="lane-count mono">${inLane.length === total ? total
            : `${inLane.length}<span class="of">/${total}</span>`}</span>
        </h2>
        <p>${esc(blurb)}</p>
      </header>
      <div class="lane-body">${cards}</div>
    </section>`;
  }).join("");

  return `<div class="board">${lanes}</div>`;
}


/* ------------------------------------------------------------------ dialog */
/* Reading one verdict from the board should not cost you your place in the
   lanes, so a card opens a dialog over them rather than navigating away.
   Uses <dialog> so the browser handles focus trapping and Escape. */

async function openBoardDialog(emailId) {
  const dlg = el("card-dialog");
  wireDialogDismissal();
  const host = el("card-dialog-body");
  dlg.showModal();
  host.innerHTML = `<div class="skeleton" style="height:260px"></div>`;

  let d = state.details[emailId];
  if (!d) {
    try {
      d = state.details[emailId] = await api(`/api/emails/${encodeURIComponent(emailId)}`);
    } catch (err) {
      host.innerHTML = `<p class="note diff">Could not load ${esc(emailId)}: ${esc(err.message)}</p>`;
      return;
    }
  }

  const isComparison = d.category === "BL_COMPARISON";
  let banner;
  if (!isComparison) {
    banner = `<div class="banner info"><svg class="ico" viewBox="0 0 24 24"><use href="#i-mail"></use></svg>
      <span>Classified <code>${esc(d.category)}</code>, so no comparison was run.</span></div>`;
  } else if (d.status === "MISMATCH") {
    banner = `<div class="banner MISMATCH"><svg class="ico" viewBox="0 0 24 24"><use href="#i-alert"></use></svg>
      <span>Discrepancy in ${(d.defect_fields || []).map((f) => `<code>${esc(f)}</code>`).join(" and ")}.
      The other fields match.</span></div>`;
  } else if (d.status === "NEEDS_REVIEW") {
    banner = `<div class="banner NEEDS_REVIEW"><svg class="ico" viewBox="0 0 24 24"><use href="#i-hand"></use></svg>
      <span>${esc(REVIEW_REASONS[d.review_reason] || "Sent for review.")}</span></div>`;
  } else {
    banner = `<div class="banner OK"><svg class="ico" viewBox="0 0 24 24"><use href="#i-check"></use></svg>
      <span>All seven fields agree between the Shipping Instruction and the draft Bill of Lading.</span></div>`;
  }

  host.innerHTML = `
    <div class="dlg-head">
      <div style="min-width:0">
        <div class="dlg-ids">
          <code>${esc(d.email_id)}</code>${statusPill(d)}
        </div>
        <h2>${esc(d.subject) || "(no subject)"}</h2>
        <p class="detail-meta"><code>${esc(d.from || "unknown sender")}</code></p>
      </div>
      <button class="icon-btn" id="card-dialog-close" aria-label="Close">&times;</button>
    </div>
    ${banner}
    ${verdictTable(d) || `<p class="note">No field comparison ran on this email.</p>`}
    <p class="dlg-foot">
      <a class="act queue-link" href="#/inbox/${encodeURIComponent(d.email_id)}"
         >Open in the queue <span aria-hidden="true">&rarr;</span></a>
      <span class="dlg-note">for the full decision trace</span>
    </p>`;

  el("card-dialog-close").addEventListener("click", () => dlg.close());

  // "Open in the queue" has to switch the layout as well as navigate: the
  // queue renders in whichever mode is current, so leaving it on board would
  // land the reader back on the lanes with nothing opened.
  host.querySelector(".act").addEventListener("click", () => {
    state.mode = "list";
    dlg.close();
  });
}

/** Native <dialog> does not close on a backdrop click, so wire it once.
 *  Comparing against the dialog's own box is more reliable than checking the
 *  event target: padding on the dialog still reports the dialog as target. */
function wireDialogDismissal() {
  const dlg = el("card-dialog");
  if (!dlg || dlg.dataset.wired) return;
  dlg.dataset.wired = "1";
  dlg.addEventListener("click", (event) => {
    const box = dlg.getBoundingClientRect();
    const outside =
      event.clientX < box.left || event.clientX > box.right ||
      event.clientY < box.top  || event.clientY > box.bottom;
    if (outside) dlg.close();
  });
}
