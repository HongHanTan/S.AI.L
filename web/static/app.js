/* Document Check Desk — review UI over a precomputed pipeline run.
 *
 * Every node is built with createElement/textContent. There is deliberately no
 * innerHTML path in this file: subjects and extracted field values are external
 * input that reached us through a document parser, so string templating would
 * be one careless interpolation away from executing markup.
 */

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

function h(tag, props, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

const el = (id) => document.getElementById(id);
const fill = (node, ...kids) => node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

// ---------------------------------------------------------------------------
// Inline icons
// ---------------------------------------------------------------------------

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_ATTRS = {
  width: "15", height: "15", viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", "stroke-width": "2",
  "stroke-linecap": "round", "stroke-linejoin": "round",
  "aria-hidden": "true", focusable: "false",
};

/** Build an inline icon from a list of [tag, attributes] shapes.
 *
 *  SVG lives in its own namespace, so these have to be created with
 *  createElementNS — an <svg> built by createElement is an HTML element that
 *  happens to be called "svg" and renders as nothing. Doing it this way also
 *  keeps the file's no-innerHTML rule intact.
 */
function icon(shapes) {
  const root = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries(ICON_ATTRS)) root.setAttribute(key, value);
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) shape.setAttribute(key, String(value));
    root.append(shape);
  }
  return root;
}

const RAY = (d) => ["path", { d }];

const SUN = [
  ["circle", { cx: 12, cy: 12, r: 4 }],
  RAY("M12 2v2"), RAY("M12 20v2"),
  RAY("m4.93 4.93 1.41 1.41"), RAY("m17.66 17.66 1.41 1.41"),
  RAY("M2 12h2"), RAY("M20 12h2"),
  RAY("m6.34 17.66-1.41 1.41"), RAY("m19.07 4.93-1.41 1.41"),
];
const MOON = [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]];

// Keyed by the CURRENT theme, but showing the icon for what a press will do:
// in the dark you reach for the sun.
const THEME_ICONS = { dark: SUN, light: MOON };

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Lanes are named after what the emails *are*, not what to do with them: an
// earlier "Document check" heading made reviewers read cleared tickets sitting
// in the lane as outstanding work.
// The keys are the category enum from src/sdoc/models.py, which is what
// submission.json is scored on. They are shown verbatim rather than prettified
// so a lane maps onto an evaluation key without a translation step.
const CATEGORY_LANES = [
  ["BL_COMPARISON", "Draft checked against instruction"],
  ["SI_REQUEST", "Shipping instruction sent or requested"],
  ["INVOICE_QUERY", "Charges, invoices and fees"],
  ["GENERAL", "Correspondence and operational updates"],
  ["SPAM", "Promotions and phishing"],
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_LANES);

const REASON_LABEL = {
  missing_attachment: "Document missing",
  wrong_doc_type: "Wrong document type",
  unreadable: "Could not read file",
  missing_value: "Field not found",
};

const FIELD_LABEL = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  container_count: "Containers",
  gross_weight_kg: "Gross weight",
};

const FIELD_ORDER = Object.keys(FIELD_LABEL);

// Gate reasons in escalation order: the three document-level problems stop
// before extraction, missing_value is the one that got as far as a field.
const REASON_ORDER = Object.keys(REASON_LABEL);

// Which rung of the ladder settled a field. An earlier exit is cheaper and
// more certain — gate1 never involves a model, L4 always does.
const LAYER_LABEL = {
  gate1: "Direct compare",
  L1: "Canonical match",
  L2: "Alias table",
  L3: "Similarity",
  L4: "Model adjudication",
  resolver: "Resolver",
};

// Written from gates.py: each reason maps 1:1 onto a gate, and a reading
// problem is never reported as a discrepancy.
const WHY = {
  missing_attachment: {
    what: "The sender says a document should be attached, and it did not arrive.",
    need: "Reply asking the sender to resend the missing document, then re-run the check.",
  },
  wrong_doc_type: {
    what: "Two documents arrived, but they are not a Shipping Instruction and a draft Bill of Lading.",
    need: "Confirm what was sent and request the correct pair.",
  },
  unreadable: {
    what: "An attachment could not be read — a corrupt file, or a scan with no text layer.",
    need: "Ask for a text-based copy, or open the file by hand and compare it manually.",
  },
  missing_value: {
    what: "A required field is absent from one of the two documents, so it cannot be compared.",
    need: "Check the document for the field before treating this as a discrepancy.",
  },
};

// Phrases worth marking in a raw email body. These are reading aids for a
// person auditing a decision — the pipeline itself never looks at them.
const HIGHLIGHT_RULES = {
  compare: ["compare the SI", "compare the draft BL", "verify the BL",
    "check the draft BL", "check the details and confirm",
    "confirm the BL is in order", "BL matches the SI", "any discrepancy",
    "kindly confirm"],
  warn: ["is still missing", "not the draft BL", "not a shipping instruction",
    "Commercial Invoice", "unable to open", "cannot be read",
    "attachment is missing", "without attachment", "appear to have been dropped",
    "appears to have been dropped", "forgot to attach", "no attachment"],
  si: ["Shipping instruction", "POL:", "POD:", "Shipper:", "Consignee:", "Notify:"],
};

/** Paint an email body into `box` with known phrases marked.
 *
 *  Text nodes and <mark> elements only. The body is unsanitised external
 *  input, so it never touches an innerHTML path. Overlapping hits are merged
 *  so a phrase is never split across two marks.
 */
function highlight(box, text) {
  box.textContent = "";
  if (!text) {
    box.append(h("span", { class: "muted", text: "(no body recorded for this email)" }));
    return;
  }

  const lower = text.toLowerCase();
  const hits = [];
  for (const [kind, phrases] of Object.entries(HIGHLIGHT_RULES)) {
    for (const phrase of phrases) {
      const needle = phrase.toLowerCase();
      for (let i = 0; ;) {
        const at = lower.indexOf(needle, i);
        if (at < 0) break;
        hits.push({ start: at, end: at + needle.length, kind });
        i = at + needle.length;
      }
    }
  }
  if (!hits.length) { box.textContent = text; return; }

  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.start < last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }

  let cursor = 0;
  for (const span of merged) {
    if (span.start > cursor) box.append(document.createTextNode(text.slice(cursor, span.start)));
    box.append(h("mark", { class: span.kind, text: text.slice(span.start, span.end) }));
    cursor = span.end;
  }
  if (cursor < text.length) box.append(document.createTextNode(text.slice(cursor)));
}

// ---------------------------------------------------------------------------
// Derived from the subject line
// ---------------------------------------------------------------------------

const PAT_BOOKING = /\b\d[A-Z]{3}-\d{5}\b/;
const PAT_PORT = /\b([A-Z][A-Z\s]{2,20})_([A-Z][A-Z\s]{2,20})\b/;

const titleCase = (s) => s.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

function bookingRef(subject) {
  const hit = PAT_BOOKING.exec(subject || "");
  return hit ? hit[0] : "";
}

function dischargePort(subject) {
  const hit = PAT_PORT.exec(subject || "");
  return hit ? `${titleCase(hit[1])}, ${titleCase(hit[2])}` : "";
}

const seqNumber = (id) => String(id || "").replace("email_", "");

// ---------------------------------------------------------------------------
// Reading a record
// ---------------------------------------------------------------------------

const isComparison = (rec) => rec.category === "BL_COMPARISON";

/** Status colour, but only where a status means something. The four other
 *  categories never run a comparison, so colouring them would imply a verdict
 *  the pipeline never reached. */
function tone(rec) {
  if (!isComparison(rec)) return "";
  return { MISMATCH: "m", NEEDS_REVIEW: "r", OK: "c" }[rec.status] || "";
}

function verdictLine(rec) {
  if (!isComparison(rec)) {
    return rec.attachment_count
      ? `${rec.attachment_count} attachment${rec.attachment_count === 1 ? "" : "s"}`
      : "No attachments";
  }
  if (rec.status === "MISMATCH") {
    const names = (rec.defect_fields || []).map((f) => FIELD_LABEL[f] || f).join(", ");
    return names ? `${names} differ` : "Mismatch found";
  }
  if (rec.status === "NEEDS_REVIEW") return REASON_LABEL[rec.review_reason] || "Needs review";
  if (rec.status === "OK") return "All 7 fields match";
  return "Not checked";
}

const displayValue = (v) => (v == null || v === "" ? null : String(v));

const isMissingRow = (v) => v.verdict === "MISSING"
  || displayValue(v.si_value) === null || displayValue(v.bl_value) === null;

const isMismatchRow = (v, defects) => v.verdict === "DIFFERENT" || defects.has(v.field_name);

const missingFieldNames = (rec) => {
  const defects = new Set(rec.defect_fields || []);
  return (rec.verdicts || [])
    .filter((v) => !isMismatchRow(v, defects) && isMissingRow(v))
    .map((v) => FIELD_LABEL[v.field_name] || v.field_name);
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state = {
  view: "inbox",
  status: "",
  reason: "",
  emails: null,
  stats: null,
  worklists: new Map(),
  lastCard: null,
  routing: false,
  // Where "Back to Board" returns to, and the scroll offsets to put back.
  origin: { view: "inbox", status: "", reason: "" },
  category: "",      // board focused on one category, "" = all five lanes
  scroll: { stacks: [], list: 0 },
  queue: null, reviewId: null,
  senders: new Map(),   // email_id -> from, filled lazily for the overview
  detailId: null,
  boardKey: null,
};

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
}

function skeleton(rows = 5) {
  return h("div", { class: "skeleton" }, Array.from({ length: rows }, () => h("i")));
}

function notice(message, retry) {
  return h("div", { class: "notice" },
    h("h3", { text: "Could not load this" }),
    h("p", { text: message }),
    retry && h("button", { class: "act", type: "button", onclick: retry, text: "Try again" }));
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function ticket(rec) {
  const ref = bookingRef(rec.subject);
  const port = dischargePort(rec.subject);
  const flavour = tone(rec);

  const card = h("button", {
    class: `card ${flavour}`.trim(),
    type: "button",
    onclick: () => openDetail(rec, card),
  },
    h("div", { class: "c-top" },
      h("span", { class: "bk", text: ref || "—" }),
      h("span", { class: "sq", text: `#${seqNumber(rec.email_id)}` })),
    // Route when the subject carries one, and the subject line always — a
    // clerk needs the shipment and the ask, not one or the other.
    port && h("p", { class: "c-route", text: `→ ${port}` }),
    h("p", { class: "c-sub", text: rec.subject || "(no subject)" }),
    h("div", { class: `mark${flavour ? "" : " none"}` },
      h("span", { text: verdictLine(rec) })));

  return card;
}

function renderBoard() {
  const board = h("div", { class: "board" });
  for (const [key, blurb] of CATEGORY_LANES) {
    const rows = state.emails.filter((e) => e.category === key);
    board.append(h("section", { class: `lane${key === "BL_COMPARISON" ? " key" : ""}` },
      h("div", { class: "lane-h" },
        h("h2", {}, h("span", { class: "enum", text: key }),
          h("span", { class: "n", text: rows.length })),
        h("p", { text: blurb })),
      h("div", { class: "stack" }, rows.map(ticket))));
  }
  fill(el("inbox"), board);
  el("inbox").dataset.key = "board";
}

// ---------------------------------------------------------------------------
// Worklist — replaces the board whenever a status filter is on
// ---------------------------------------------------------------------------

function worklistRow(rec) {
  const flavour = tone(rec);
  // Only comparison emails carry a meaningful status; the other four
  // categories never run one, so the column shows the category instead.
  const label = !isComparison(rec)
    ? rec.category
    : rec.status === "NEEDS_REVIEW"
      ? (REASON_LABEL[rec.review_reason] || "Review").toUpperCase()
      : rec.status === "MISMATCH" ? "MISMATCH" : "CLEARED";

  let what;
  if (!isComparison(rec)) {
    what = h("span", { class: "desc", text: rec.subject || "(no subject)" });
  } else if (rec.status === "MISMATCH") {
    what = h("span", { class: "desc" },
      h("b", { text: (rec.defect_fields || []).map((f) => FIELD_LABEL[f] || f).join(", ") }),
      " ", h("em", { text: "differ between SI and draft BL" }));
  } else if (rec.status === "NEEDS_REVIEW") {
    what = h("span", { class: "desc", text: (WHY[rec.review_reason] || {}).what || verdictLine(rec) });
  } else {
    what = h("span", { class: "desc" }, h("em", { text: "All seven fields match" }));
  }

  const row = h("button", {
    class: `row ${flavour}`.trim(),
    type: "button",
    onclick: () => openDetail(rec, row),
  },
    h("span", { class: "st", text: label }),
    h("span", { class: "bk2", text: bookingRef(rec.subject) || "—" }),
    what,
    h("span", { class: "id2", text: `#${seqNumber(rec.email_id)}` }));

  return row;
}

/** The worklist is the board's flat mode: one category in full, or one status
 *  within BL_COMPARISON. Both narrow server side through /api/emails. */
async function renderWorklist() {
  const category = state.category || "BL_COMPARISON";
  const wanted = state.category ? "" : state.status;
  const cacheKey = `${category}|${wanted}`;

  if (!state.worklists.has(cacheKey)) {
    fill(el("inbox"), skeleton());
    try {
      const params = new URLSearchParams({ category });
      if (wanted) params.set("status", wanted);
      state.worklists.set(cacheKey, await api(`/api/emails?${params}`));
    } catch (err) {
      delete el("inbox").dataset.key;
      fill(el("inbox"), notice(err.message, () => renderInbox()));
      return;
    }
    if ((state.category || "BL_COMPARISON") !== category) return;  // changed in flight
  }

  let rows = state.worklists.get(cacheKey);
  if (wanted === "NEEDS_REVIEW" && state.reason) {
    rows = rows.filter((r) => r.review_reason === state.reason);
  }

  const label = state.category
    ? `in ${state.category}`
    : { MISMATCH: "with a mismatch", OK: "cleared", NEEDS_REVIEW: "awaiting a person" }[wanted];

  const head = h("div", { class: "list-h", "aria-live": "polite" },
    h("b", { text: rows.length }), ` ${label}`);
  if (state.category) {
    head.append(h("button", { class: "act ghost", type: "button", text: "Show all lanes",
      onclick: () => { state.category = ""; delete el("inbox").dataset.key; pushRoute(); render(); } }));
  }

  const list = h("div", { class: "list" }, head);
  if (rows.length) list.append(...rows.map(worklistRow));
  else list.append(h("p", { class: "empty", text: "Nothing here." }));

  fill(el("inbox"), list);
  el("inbox").dataset.key = `list:${cacheKey}:${state.reason}`;
}

// ---------------------------------------------------------------------------
// Overview workspace
// ---------------------------------------------------------------------------

function kpi(value, label, note, flavour) {
  return h("div", { class: `kpi ${flavour || ""}`.trim() },
    h("b", { text: value }),
    h("span", { class: "kpi-l", text: label }),
    h("span", { class: "kpi-n", text: note }));
}

/** Shared chrome for the analysis panels, so they read as one instrument. */
function insight(title, sub, ...body) {
  return h("section", { class: "ins" },
    h("header", { class: "ins-h" },
      h("h3", { text: title }),
      sub && h("p", { text: sub })),
    ...body.filter(Boolean));
}

/** Which of the seven fields actually fail, ranked.
 *
 *  defect_fields is only ever populated on MISMATCH records — the four gate
 *  reasons stop before extraction ever runs — so this counts the flagged
 *  shipments and nothing else. Bars are scaled to the worst field rather than
 *  to the total, because the question this panel answers is which field is
 *  worst, not how the total divides up.
 */
function fieldBreakdown(flagged) {
  const counts = new Map(FIELD_ORDER.map((f) => [f, 0]));
  for (const rec of flagged) {
    for (const field of rec.defect_fields || []) {
      counts.set(field, (counts.get(field) || 0) + 1);
    }
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const worst = ranked.length ? ranked[0][1] : 0;
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);

  const row = ([field, n]) => h("li", { class: `bar${n ? "" : " zero"}` },
    h("span", { class: "bar-k", text: field }),
    h("span", { class: "bar-t" },
      h("i", { style: `width:${worst ? Math.round((n / worst) * 100) : 0}%` })),
    h("span", { class: "bar-n", text: n }),
    h("span", { class: "bar-p",
      text: flagged.length ? `${Math.round((n / flagged.length) * 100)}%` : "0%" }));

  return insight("Field discrepancy breakdown",
    flagged.length
      ? `${total} defect${total === 1 ? "" : "s"} across ${flagged.length} flagged `
        + `shipments · share is of those ${flagged.length}`
      : "No discrepancies in this run.",
    flagged.length
      ? h("ul", { class: "bars" },
          h("li", { class: "bar head" },
            h("span", { class: "bar-k", text: "FIELD" }),
            h("span", {}),
            h("span", { class: "bar-n", text: "N" }),
            h("span", { class: "bar-p", text: "SHARE" })),
          ranked.map(row))
      : h("p", { class: "empty", text: "Nothing to break down." }));
}

/** Why the escalations stopped, and a way into each filtered slice.
 *
 *  The one-line notes come from WHY rather than from new copy, so the
 *  dashboard and the detail page explain a gate the same way.
 */
function rootCauses(escalations) {
  const counts = new Map(REASON_ORDER.map((r) => [r, 0]));
  for (const rec of escalations) {
    if (counts.has(rec.review_reason)) counts.set(rec.review_reason, counts.get(rec.review_reason) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);

  const row = ([reason, n]) => h("button", {
    class: `cause${n ? "" : " zero"}`, type: "button", disabled: n === 0,
    onclick: () => openReason(reason),
  },
    h("span", { class: "cause-n", text: n }),
    h("span", { class: "cause-b" },
      h("span", { class: "cause-k", text: REASON_LABEL[reason] || reason }),
      h("span", { class: "cause-d", text: (WHY[reason] || {}).what || "" })),
    h("span", { class: "cause-go", "aria-hidden": "true", text: "→" }));

  return insight("Escalation root causes",
    escalations.length
      ? `${escalations.length} shipments held for a person · open a cause to `
        + "see just those tickets"
      : "Nothing is waiting on a person.",
    h("div", { class: "causes" }, ranked.map(row)));
}

const ESCALATION_PREVIEW = 6;

/** The sender is on the detail endpoint only — the list and the queue both
 *  omit it. Rather than widen a backend contract for one column, the preview
 *  fetches it for the handful of shipments actually on screen and patches the
 *  cells when it lands. Nothing else on the row waits for it, and a failure
 *  degrades to an em-dash instead of blanking the table.
 */
async function loadSenders(ids) {
  const wanted = ids.filter((id) => !state.senders.has(id));
  if (wanted.length) {
    await Promise.all(wanted.map(async (id) => {
      try {
        const rec = await api(`/api/emails/${encodeURIComponent(id)}`);
        state.senders.set(id, rec.from || "");
      } catch {
        state.senders.set(id, "");
      }
    }));
  }
  for (const cell of document.querySelectorAll("#overview [data-sender]")) {
    const from = state.senders.get(cell.dataset.sender);
    if (from !== undefined) cell.textContent = from || "—";
  }
}

function escalationTable(escalations) {
  const preview = escalations.slice(0, ESCALATION_PREVIEW);

  const row = (rec) => h("tr", {},
    h("td", {}, h("span", { class: "bk2", text: bookingRef(rec.subject) || rec.email_id })),
    h("td", { class: "e-route", text: dischargePort(rec.subject) || "—" }),
    h("td", {}, h("span", { class: "rbadge",
      text: REASON_LABEL[rec.review_reason] || "Needs review" })),
    h("td", { class: "e-from", dataset: { sender: rec.email_id }, text: "…" }),
    h("td", { class: "e-act" },
      h("button", { class: "act ghost", type: "button",
        onclick: () => openReview(rec.email_id),
        text: "Review →" })));

  const table = h("table", { class: "esc" },
    h("thead", {}, h("tr", {},
      h("th", { text: "Booking ref" }),
      h("th", { text: "Discharge port" }),
      h("th", { text: "Review reason" }),
      h("th", { class: "e-from", text: "Sender" }),
      h("th", { class: "e-act", text: "Action" }))),
    h("tbody", {}, preview.map(row)));

  loadSenders(preview.map((rec) => rec.email_id));

  return insight("Active escalations awaiting review",
    `${preview.length} of ${escalations.length} held shipments`,
    table,
    escalations.length > preview.length
      && h("footer", { class: "ins-f" },
        h("button", { class: "act ghost", type: "button", onclick: () => go("review"),
          text: `Open the full queue of ${escalations.length} →` })));
}

function renderOverview() {
  if (!state.emails) { fill(el("overview"), skeleton(4)); return; }

  const bl = state.emails.filter(isComparison);
  const flagged = bl.filter((e) => e.status === "MISMATCH");
  const escalations = bl.filter((e) => e.status === "NEEDS_REVIEW");

  const grid = h("div", { class: "kpi-grid" },
    kpi(state.emails.length, "Total triaged", "Emails classified end to end", ""),
    kpi(bl.length, "BL comparison", "Routed to active verification", ""),
    kpi(flagged.length, "Discrepancies", "Field mismatches caught", "m"),
    kpi(escalations.length, "Human escalation", "Held for a person to resolve", "r"));

  // Category volume lives on the triage board, which shows the same five
  // lanes with the same counts; repeating it here was the redundant row.
  fill(el("overview"),
    h("div", { class: "ov" },
      h("h2", { class: "ov-h", text: "Operations summary" }),
      grid,
      h("div", { class: "ins-grid" }, fieldBreakdown(flagged), rootCauses(escalations)),
      escalations.length > 0 && escalationTable(escalations)));
}

/** Drill from a root cause into exactly that slice of the board. */
function openReason(reason) {
  state.view = "inbox";
  state.category = "";
  state.status = "NEEDS_REVIEW";
  state.reason = reason;
  state.detailId = null;
  delete el("inbox").dataset.key;
  pushRoute();
  render();
}

/** Open one escalation in the review queue, selected. */
function openReview(id) {
  captureScroll();
  state.view = "review";
  state.reviewId = id;
  state.detailId = null;
  state.status = "";
  state.reason = "";
  state.category = "";
  pushRoute();
  render();
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function renderFilters() {
  const bl = state.emails.filter(isComparison);
  const count = (s) => bl.filter((e) => e.status === s).length;
  el("f-all").textContent = bl.length;
  el("f-mismatch").textContent = count("MISMATCH");
  el("f-review").textContent = count("NEEDS_REVIEW");
  el("f-ok").textContent = count("OK");
  for (const chip of document.querySelectorAll(".chip.s")) {
    chip.setAttribute("aria-pressed", String(chip.dataset.status === state.status));
  }
}

function renderReasonChips() {
  const bar = el("subbar");
  if (state.status !== "NEEDS_REVIEW") {
    fill(bar);
    return;
  }
  const pool = state.emails.filter((e) => isComparison(e) && e.status === "NEEDS_REVIEW");
  const counts = {};
  for (const e of pool) counts[e.review_reason] = (counts[e.review_reason] || 0) + 1;

  // Grouped by reason because each one needs a different action — chasing five
  // missing documents at once beats context-switching case by case.
  const options = [["", "All reasons", pool.length]].concat(
    Object.keys(REASON_LABEL).filter((k) => counts[k]).map((k) => [k, REASON_LABEL[k], counts[k]]));

  fill(bar, options.map(([value, text, n]) => h("button", {
    class: "chip",
    type: "button",
    "aria-pressed": String(state.reason === value),
    onclick: () => { state.reason = value; pushRoute(); render(); },
  }, text, h("span", { class: "k", text: n }))));
}

// ---------------------------------------------------------------------------
// Full-page detail view
// ---------------------------------------------------------------------------

function summaryRows(rec) {
  const rows = [["Triaged as", rec.category, "mono"],
    ["", CATEGORY_LABEL[rec.category] || "", "gloss"]];
  if (isComparison(rec)) {
    rows.push(["Check result", verdictLine(rec), tone(rec)]);
    if (rec.review_reason) {
      rows.push(["Review reason", REASON_LABEL[rec.review_reason] || rec.review_reason, "r"]);
    }
    if ((rec.defect_fields || []).length) {
      rows.push(["Fields to fix", rec.defect_fields.map((f) => FIELD_LABEL[f] || f).join(", "), "m"]);
    }
    const absent = missingFieldNames(rec);
    if (absent.length) rows.push(["Fields not found", absent.join(", "), "r"]);
  }
  if (rec.from) rows.push(["From", rec.from, ""]);
  rows.push(["Email id", rec.email_id, "mono"]);
  return rows.filter(([, value]) => value !== "").flatMap(([key, value, cls]) => [
    h("dt", { text: key }),
    h("dd", { class: cls || null, text: value }),
  ]);
}

function whyBlock(rec) {
  if (rec.status !== "NEEDS_REVIEW" || !isComparison(rec)) return null;
  const copy = WHY[rec.review_reason];
  if (!copy) return null;

  // What the system found, stated from the record rather than from a template.
  let found;
  if (rec.review_reason === "missing_attachment") {
    found = `${rec.attachment_count || 0} attachment${rec.attachment_count === 1 ? "" : "s"} received; `
      + "the message body reports one missing.";
  } else if (rec.review_reason === "missing_value") {
    const gaps = missingFieldNames(rec);
    found = gaps.length
      ? `Not found in one document: ${gaps.join(", ")}.`
      : "At least one of the seven fields could not be read from one document.";
  } else if (rec.review_reason === "unreadable") {
    found = "Text extraction returned nothing usable for at least one attachment.";
  } else {
    found = "Header detection could not assign one document to each role.";
  }

  return h("div", { class: "clar" },
    h("h4", { text: "WHY THIS NEEDS A PERSON" }),
    h("p", { text: copy.what }),
    h("p", {}, h("span", { class: "lbl", text: "WHAT THE SYSTEM FOUND" }),
      h("span", { class: "ev", text: found })),
    h("p", {}, h("span", { class: "lbl", text: "SUGGESTED NEXT STEP" }), copy.need));
}

function comparisonRows(verdicts, defectFields = []) {
  const defects = new Set(defectFields);
  const byField = new Map(verdicts.map((v) => [v.field_name, v]));
  return FIELD_ORDER.filter((f) => byField.has(f)).map((field) => {
    const v = byField.get(field);
    // A discrepancy outranks a gap, matching rollup.py: a confirmed DIFFERENT
    // is a defect, while an unread value is only a reading problem.
    const differs = isMismatchRow(v, defects);
    const missing = !differs && isMissingRow(v);

    const cell = (raw) => {
      const value = displayValue(raw);
      return value
        ? h("td", { class: "v", text: value })
        : h("td", { class: "v none", text: "\u2014 (Not found)" });
    };

    return h("tr", { class: differs ? "row-mismatch" : missing ? "row-missing" : null },
      h("td", { class: "fn", text: FIELD_LABEL[field] || field }),
      cell(v.si_value),
      cell(v.bl_value),
      h("td", { class: "by" },
        LAYER_LABEL[v.decided_by] || v.decided_by,
        v.similarity != null && " ",
        v.similarity != null && h("span", { class: "sim", text: v.similarity.toFixed(3) })));
  });
}

function crumbText() {
  const { view, status, reason } = state.origin;
  if (view === "review") return "from Review queue";
  if (view === "compare") return "from Try an email";
  if (!status) return "from Board \u00b7 all comparisons";
  const label = { MISMATCH: "Mismatch found", NEEDS_REVIEW: "Needs review", OK: "Cleared" }[status];
  return `from Board \u00b7 ${label}${reason ? " \u00b7 " + (REASON_LABEL[reason] || reason) : ""}`;
}

function renderDetail(rec) {
  const ref = bookingRef(rec.subject);
  const port = dischargePort(rec.subject);
  const flavour = tone(rec);

  el("detail-title").textContent = ref || rec.email_id;
  el("detail-route").textContent = port ? `\u2192 ${port}` : "";
  el("detail-route").hidden = !port;
  el("detail-subject").textContent = rec.subject || "(no subject)";
  el("detail-crumb").textContent = crumbText();

  // Enum values verbatim: these are the submission.json keys being scored.
  fill(el("detail-pills"),
    h("span", { class: "pill mono", title: CATEGORY_LABEL[rec.category] || "", text: rec.category }),
    isComparison(rec) && rec.status
      && h("span", { class: `pill mono ${flavour}`.trim(), text: rec.status }),
    isComparison(rec) && rec.review_reason
      && h("span", { class: "pill mono r", text: rec.review_reason }),
    h("span", { class: "pill mono", text: rec.email_id }));

  fill(el("detail-why"), [whyBlock(rec)].filter(Boolean));
  fill(el("detail-summary"), summaryRows(rec));

  // Most NEEDS_REVIEW records stop before extraction and carry no verdicts at
  // all, so the table hides rather than showing an empty frame.
  const verdicts = rec.verdicts || [];
  el("report").hidden = verdicts.length === 0;
  fill(el("report-body"), verdicts.length ? comparisonRows(verdicts, rec.defect_fields || []) : []);
  fill(el("detail-notes"), (rec.notes || []).map((n) => h("p", { class: "note", text: n })));

  // Body and attachment names are enrichment from the organiser bundle. The
  // deployed app ships only run.json, so both are routinely absent.
  fill(el("original-meta"),
    h("dt", { text: "From" }), h("dd", { text: rec.from || "\u2014" }),
    h("dt", { text: "Subject" }), h("dd", { text: rec.subject || "(no subject)" }),
    h("dt", { text: "Attachments" }),
    h("dd", { text: rec.attachment_count
      ? `${rec.attachment_count} file${rec.attachment_count === 1 ? "" : "s"} received`
      : "None received" }));

  const hasBody = typeof rec.body === "string" && rec.body !== "";
  highlight(el("original-body"), hasBody ? rec.body : "");
  el("original-legend").hidden = !hasBody;
  fill(el("original-files"), (rec.attachment_names || []).map((name) => h("li", { text: name })));
}

function captureScroll() {
  if (state.view !== "inbox") return;
  state.scroll.stacks = [...document.querySelectorAll("#inbox .stack")].map((n) => n.scrollTop);
  const list = document.querySelector("#inbox .list");
  state.scroll.list = list ? list.scrollTop : 0;
}

function restoreScroll() {
  const stacks = [...document.querySelectorAll("#inbox .stack")];
  state.scroll.stacks.forEach((top, i) => { if (stacks[i]) stacks[i].scrollTop = top; });
  const list = document.querySelector("#inbox .list");
  if (list) list.scrollTop = state.scroll.list;
}

async function openDetail(rec, trigger) {
  // Remember where to go back to, but never overwrite it when moving from one
  // detail page straight to another.
  if (state.view !== "detail") {
    captureScroll();
    state.origin = { view: state.view, status: state.status, reason: state.reason };
  }
  state.lastCard = trigger || null;
  state.detailId = rec.email_id;
  state.view = "detail";

  renderDetail(rec);
  showDestination();
  el("detail").scrollTop = 0;
  el("detail").focus();
  pushRoute();

  // The list payload has no verdicts; fetch the full record to fill the table
  // and pick up body/attachment enrichment.
  try {
    const detail = await api(`/api/emails/${encodeURIComponent(rec.email_id)}`);
    if (state.view === "detail" && state.detailId === rec.email_id) renderDetail(detail);
  } catch {
    el("report").hidden = true;
    fill(el("detail-notes"), notice("The full record could not be loaded.", null));
  }
}

function goBack() {
  const { view, status, reason } = state.origin;
  state.view = view;
  state.status = status;
  state.reason = reason;
  pushRoute();
  render();
  restoreScroll();
  setTimeout(restoreScroll, 0);
  if (state.lastCard && state.lastCard.isConnected) state.lastCard.focus();
  state.lastCard = null;
}

el("detail-back").addEventListener("click", goBack);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.view === "detail") goBack();
});

// ---------------------------------------------------------------------------
// Review queue
// ---------------------------------------------------------------------------

function judgeBlock(item, verdict) {
  const acts = h("div", { class: "acts" });
  const block = h("div", { class: "judge" },
    h("div", { class: "pair" },
      h("b", { text: FIELD_LABEL[verdict.field_name] || verdict.field_name }),
      h("span", { class: "lbl2", text: "SI (reference)" }),
      h("span", { text: displayValue(verdict.si_value) || "not found" }),
      h("span", { class: "lbl2", text: "Draft BL" }),
      h("span", { text: displayValue(verdict.bl_value) || "not found" })),
    acts);

  const decide = async (choice, button) => {
    button.disabled = true;
    try {
      await api(`/api/review/${encodeURIComponent(item.email_id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: verdict.field_name, verdict: choice }),
      });
      fill(block, h("p", { class: "done" },
        `Recorded: ${FIELD_LABEL[verdict.field_name] || verdict.field_name} → ${choice}. `
        + "It enters the alias table at the next promotion."));
    } catch (err) {
      button.disabled = false;
      fill(acts, ...acts.childNodes, h("span", { class: "hint", text: err.message }));
    }
  };

  for (const [choice, label] of [["SAME", "Same entity"], ["DIFFERENT", "Different"]]) {
    const button = h("button", { class: "act", type: "button", text: label });
    button.addEventListener("click", () => decide(choice, button));
    acts.append(button);
  }
  return block;
}

/** The review queue is a split workspace: the escalation list on the left,
 *  the selected case opened beside it rather than on top of it. */
async function renderReview() {
  if (el("review").dataset.ready) { paintReviewSelection(); return; }

  fill(el("review"), skeleton(3));
  let queue;
  try {
    queue = await api("/api/review-queue");
  } catch (err) {
    fill(el("review"), notice(err.message, () => { delete el("review").dataset.ready; renderReview(); }));
    return;
  }

  state.queue = queue;
  el("tab-review-count").textContent = queue.length;
  if (!queue.length) {
    fill(el("review"), h("p", { class: "empty", text: "Review queue is empty." }));
    return;
  }

  const list = h("div", { class: "rq-list" },
    h("div", { class: "list-h" }, h("b", { text: queue.length }), " awaiting a person"));

  for (const item of queue) {
    const row = h("button", {
      class: "rq-row", type: "button", dataset: { id: item.email_id },
      onclick: () => selectReview(item.email_id),
    },
      h("span", { class: "rq-top" },
        h("span", { class: "bk2", text: bookingRef(item.subject) || item.email_id }),
        h("span", { class: "id2", text: `#${seqNumber(item.email_id)}` })),
      h("span", { class: "rq-why" },
        h("span", { class: "gl", "aria-hidden": "true", text: "⚡" }),
        REASON_LABEL[item.review_reason] || item.review_reason || "Needs review"),
      h("span", { class: "rq-sub", text: item.subject || "(no subject)" }));
    list.append(row);
  }

  fill(el("review"),
    h("div", { class: "rq" }, list, h("div", { class: "rq-pane", id: "rq-pane" })));
  el("review").dataset.ready = "1";
  paintReviewSelection();
}

function selectReview(id) {
  state.reviewId = id;
  pushRoute();          // so a selected escalation is linkable and reload-safe
  paintReviewSelection();
}

function paintReviewSelection() {
  const pane = el("rq-pane");
  if (!pane) return;
  for (const row of document.querySelectorAll(".rq-row")) {
    row.classList.toggle("on", row.dataset.id === state.reviewId);
  }
  const item = (state.queue || []).find((q) => q.email_id === state.reviewId);
  if (!item) {
    fill(pane, h("p", { class: "empty",
      text: "Select an escalation to see why it stopped and settle its fields." }));
    return;
  }

  const body = h("div", { class: "panel" },
    h("h3", { text: "Escalation" }),
    h("div", { class: "rq-head" },
      h("span", { class: "bk3", text: bookingRef(item.subject) || item.email_id }),
      h("span", { class: "pill mono r", text: item.review_reason || "NEEDS_REVIEW" })),
    h("p", { class: "subj", text: item.subject || "(no subject)" }));

  const copy = WHY[item.review_reason];
  if (copy) {
    body.append(h("div", { class: "clar" },
      h("h4", { text: "WHY THIS NEEDS A PERSON" }),
      h("p", { text: copy.what }),
      h("p", {}, h("span", { class: "lbl", text: "SUGGESTED NEXT STEP" }), copy.need)));
  }

  const verdicts = item.verdicts || [];
  if (verdicts.length) {
    body.append(
      h("h3", { class: "sub-h", text: "Field comparison" }),
      h("div", { class: "table-wrap" },
        h("table", { class: "cmp" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col", class: "c-field", text: "Field" }),
            h("th", { scope: "col", class: "c-si", text: "SI (reference)" }),
            h("th", { scope: "col", class: "c-bl", text: "Draft BL" }),
            h("th", { scope: "col", class: "c-by", text: "Decided by" }))),
          h("tbody", {}, comparisonRows(verdicts)))),
      h("h3", { class: "sub-h", text: "Settle a field" }),
      ...verdicts.map((v) => judgeBlock(item, v)));
  } else {
    body.append(h("p", { class: "note",
      text: "No field comparison ran — resolve the document problem first." }));
  }

  body.append(h("p", { class: "note" },
    h("button", { class: "act ghost", type: "button", text: "Open full record →",
      onclick: () => {
        const rec = (state.emails || []).find((e) => e.email_id === item.email_id);
        if (rec) openDetail(rec, null);
      } })));

  fill(pane, body);
  pane.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Try an email
// ---------------------------------------------------------------------------

const EXAMPLES = {
  comparison: {
    from: "docs@vitalsolutions.sg",
    subject: "TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI_PAKISTAN",
    body: ["Hi Mitchelle,", "", "Attached are the SI and draft BL for OC 5ALT-01226.",
      "Please check the details and confirm.", "", "Best Regards,", "Deswita"].join("\n"),
    hint: "Now attach an SI and a BL, then Process email.",
  },
  spam: {
    from: "offers@quick-cargo-deals.biz",
    subject: "Increase your shipping revenue with this ONE weird trick",
    body: "Click here now to unlock unlimited freight discounts!",
    hint: "No attachments needed — just Process email.",
  },
};

function renderCompare() {
  if (el("compare").dataset.ready) return;
  el("compare").dataset.ready = "1";

  const field = (id, label, node) => h("div", {}, h("label", { for: id, text: label }), node);

  const from = h("input", { class: "field", type: "text", id: "cmp-from",
    placeholder: "docs@vitalsolutions.sg" });
  const subject = h("input", { class: "field", type: "text", id: "cmp-subject",
    placeholder: "TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI" });
  const body = h("textarea", { class: "field", id: "cmp-body", rows: 6,
    placeholder: "Hi,\n\nAttached are the SI and draft BL. Please check the details and confirm.\n\nThanks" });
  const files = h("input", { class: "field", type: "file", id: "cmp-files", multiple: true });
  const hint = h("span", { class: "hint" });
  const out = h("div", { id: "cmp-out" });

  const run = h("button", { class: "act primary", type: "button", text: "Process email" });
  const loadExample = (key) => () => {
    from.value = EXAMPLES[key].from;
    subject.value = EXAMPLES[key].subject;
    body.value = EXAMPLES[key].body;
    hint.textContent = EXAMPLES[key].hint;
  };

  run.addEventListener("click", async () => {
    if (!subject.value.trim() && !body.value.trim()) {
      hint.textContent = "Write a subject or a body first.";
      return;
    }
    run.disabled = true;
    hint.textContent = "Processing…";
    fill(out);

    const form = new FormData();
    form.append("subject", subject.value);
    form.append("body", body.value);
    form.append("sender", from.value);
    for (const file of files.files) form.append("files", file);

    try {
      const response = await fetch("/api/try-email", { method: "POST", body: form });
      const data = await response.json();
      hint.textContent = "";
      fill(out, response.ok
        ? tryResult(data)
        : notice(data.detail || "Processing failed.", null));
    } catch {
      hint.textContent = "";
      fill(out, notice("Could not reach the server.", null));
    } finally {
      run.disabled = false;
    }
  });

  fill(el("compare"), h("div", { class: "panel" },
    h("h2", { text: "Try an email" }),
    h("p", { text: "Write an email the way a customer would and attach whatever documents it "
      + "would carry — or none. This runs the whole pipeline: classification, document "
      + "typing, extraction, comparison and rollup. It is the same code path the 520-email "
      + "batch run uses." }),
    h("p", { text: "You never say which attachment is the Shipping Instruction and which is "
      + "the draft Bill of Lading. Each document's own header decides, because in real "
      + "inboxes filenames lie." }),
    h("div", { class: "form" },
      field("cmp-from", "FROM", from),
      field("cmp-subject", "SUBJECT", subject),
      field("cmp-body", "BODY", body),
      field("cmp-files", "ATTACHMENTS (OPTIONAL, ANY ORDER)", files),
      h("div", { class: "acts-row" },
        run,
        h("button", { class: "act", type: "button", text: "Load a comparison example",
          onclick: loadExample("comparison") }),
        h("button", { class: "act", type: "button", text: "Load a spam example",
          onclick: loadExample("spam") }),
        hint)),
    out));
}

function tryResult(data) {
  const comparison = data.category === "BL_COMPARISON" || !data.category;
  const flavour = comparison
    ? { MISMATCH: "m", NEEDS_REVIEW: "r", OK: "c" }[data.status] || ""
    : "";

  let headline;
  if (!comparison) headline = "Not a document-comparison request, so no comparison was run.";
  else if (data.status === "MISMATCH") {
    headline = `Mismatch in: ${(data.defect_fields || []).map((f) => FIELD_LABEL[f] || f).join(", ")}`;
  } else if (data.status === "NEEDS_REVIEW") {
    headline = `Sent for review — ${REASON_LABEL[data.review_reason] || data.review_reason}`;
  } else headline = "No mismatch detected.";

  const result = h("div", { class: "result" }, h("h3", { text: "Outcome" }), h("dl", {},
    h("dt", { text: "Classified as" }),
    h("dd", { class: "mono", title: CATEGORY_LABEL[data.category] || "",
      text: data.category || "—" }),
    h("dt", { text: "Result" }),
    h("dd", { class: `mono ${flavour}`.trim(),
      text: comparison ? (data.status || "—") : "—" }),
    data.classifier && data.classifier !== "gemini" && h("dt", { text: "Classifier" }),
    data.classifier && data.classifier !== "gemini" && h("dd", { text: data.classifier })));

  result.append(h("p", { class: `verdict-line ${flavour}`.trim(), text: headline }));

  const documents = data.documents || [];
  if (documents.length) {
    result.append(h("p", { class: "note", text: "Documents read as:" }),
      h("ul", { class: "docs" }, documents.map((doc) => h("li", {},
        h("code", { text: doc.filename }), " → ",
        { SI: "Shipping Instruction", BL: "Bill of Lading" }[doc.detected_type]
          || "not a shipping document",
        doc.error ? ` (${doc.error})` : ""))));
  }

  for (const note of data.notes || []) result.append(h("p", { class: "note", text: note }));

  const verdicts = data.verdicts || [];
  if (verdicts.length) {
    result.append(h("h3", { text: "Field comparison", style: "margin-top:18px" }),
      h("div", { class: "table-wrap" },
        h("table", { class: "cmp" },
          h("thead", {}, h("tr", {},
            h("th", { scope: "col", text: "Field" }),
            h("th", { scope: "col", text: "SI (reference)" }),
            h("th", { scope: "col", text: "Draft BL" }),
            h("th", { scope: "col", text: "Decided by" }))),
          h("tbody", {}, comparisonRows(verdicts, data.defect_fields || [])))));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Views and routing
// ---------------------------------------------------------------------------

// #/overview | #/triage | #/triage/c/SPAM | #/triage/s/MISMATCH[/reason]
// | #/review[/id] | #/try | #/email/:id
function routeForView() {
  if (state.view === "detail" && state.detailId) return `#/email/${state.detailId}`;
  if (state.view === "overview") return "#/overview";
  if (state.view === "review") return state.reviewId ? `#/review/${state.reviewId}` : "#/review";
  if (state.view === "compare") return "#/try";
  if (state.category) return `#/triage/c/${state.category}`;
  if (!state.status) return "#/triage";
  return state.reason
    ? `#/triage/s/${state.status}/${state.reason}`
    : `#/triage/s/${state.status}`;
}

function pushRoute() {
  const next = routeForView();
  if (location.hash === next) return;
  state.routing = true;
  location.hash = next;
  state.routing = false;
}

function applyRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "email" && parts[1]) {
    const rec = (state.emails || []).find((e) => e.email_id === parts[1]);
    if (rec) { openDetail(rec, null); return; }
  }

  if (parts[0] === "review") {
    state.view = "review";
    state.reviewId = parts[1] || state.reviewId;
  } else if (parts[0] === "try") {
    state.view = "compare";
  } else if (parts[0] === "triage") {
    state.view = "inbox";
    // c/<CATEGORY> focuses one lane; s/<STATUS>[/reason] filters within
    // BL_COMPARISON. The discriminator keeps the two unambiguous.
    const cat = parts[1] === "c" && CATEGORY_LABEL[parts[2]] ? parts[2] : "";
    state.category = cat;
    const wantStatus = parts[1] === "s" && !cat;
    state.status = wantStatus && ["MISMATCH", "NEEDS_REVIEW", "OK"].includes(parts[2]) ? parts[2] : "";
    state.reason = state.status === "NEEDS_REVIEW" && REASON_LABEL[parts[3]] ? parts[3] : "";
  } else {
    state.view = "overview";
  }
  render();
}

// The three top destinations are mutually exclusive: exactly one panel is on
// screen at a time, and the status filters and reason chips belong to the
// board alone.
const DESTINATIONS = ["overview", "inbox", "review", "compare", "detail"];

function showDestination() {
  for (const id of DESTINATIONS) el(id).hidden = id !== state.view;

  // On a detail page no section is "current", so the tab it was opened from
  // stays selected — the page is a sub-view of that section, not a peer.
  const marked = state.view === "detail" ? state.origin.view : state.view;
  for (const tab of document.querySelectorAll(".tab")) {
    const active = tab.dataset.view === marked;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;   // roving focus: one stop for the group
  }

  // The status ledger belongs to the triage board, and only when it is not
  // already narrowed to a single category.
  const onBoard = state.view === "inbox" && !state.category;
  el("filters").hidden = !onBoard;
  if (!onBoard) fill(el("subbar"));
}

function render() {
  showDestination();

  if (state.view === "overview") {
    renderOverview();
  } else if (state.view === "inbox") {
    if (!state.emails) return;
    renderFilters();
    renderReasonChips();
    const key = state.category
      ? `list:${state.category}|:${state.reason}`
      : state.status ? `list:BL_COMPARISON|${state.status}:${state.reason}` : "board";
    if (el("inbox").dataset.key !== key) {
      if (state.category || state.status) renderWorklist(); else renderBoard();
    }
  } else if (state.view === "review") {
    renderReview();
  } else if (state.view === "compare") {
    renderCompare();
  }
}

function go(view) {
  captureScroll();
  state.view = view;
  state.detailId = null;
  if (view !== "inbox") { state.status = ""; state.reason = ""; state.category = ""; }
  pushRoute();
  render();
}

const tabs = [...document.querySelectorAll(".tab")];
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => go(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    next.focus();
    go(next.dataset.view);
  });
});

for (const chip of document.querySelectorAll(".chip.s")) {
  chip.addEventListener("click", () => {
    state.status = chip.dataset.status;
    state.reason = "";
    pushRoute();
    render();
  });
}

window.addEventListener("hashchange", () => { if (!state.routing) applyRoute(); });

// ---------------------------------------------------------------------------
// Theme — system by default, overridable, remembered where storage allows
// ---------------------------------------------------------------------------

const THEMES = ["dark", "light"];

/** First visit follows the operating system; after that the button decides.
 *  A stored "auto" from an earlier build is not a valid state any more, so it
 *  falls through to the system preference and is replaced on the next press.
 */
function initialTheme() {
  try {
    const stored = localStorage.getItem("sdoc-theme");
    if (THEMES.includes(stored)) return stored;
  } catch { /* private windows and blocked storage just use the system */ }
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark" : "light";
}

let theme = initialTheme();

function applyTheme() {
  document.documentElement.setAttribute("data-theme", theme);

  // Icon-only control, and the icon names the destination rather than the
  // current state — so the accessible name has to say the same thing.
  const next = theme === "dark" ? "light" : "dark";
  const button = el("theme");
  fill(button, icon(THEME_ICONS[theme]));
  button.setAttribute("aria-label", `Switch to ${next} theme`);
  button.title = `Switch to ${next} theme`;
}
el("theme").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("sdoc-theme", theme); } catch { /* not essential */ }
  applyTheme();
});
applyTheme();

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function station(state_, text) {
  el("sysdot").className = `sysdot ${state_}`;
  el("systext").textContent = text;
}

async function boot() {
  fill(el("overview"), skeleton(4));
  try {
    const [emails, stats] = await Promise.all([api("/api/emails"), api("/api/stats")]);
    state.emails = emails;
    state.stats = stats;
  } catch (err) {
    station("bad", "Feed unavailable");
    fill(el("overview"), notice(err.message, boot));
    return;
  }

  const bl = state.emails.filter(isComparison);
  const escalations = bl.filter((e) => e.status === "NEEDS_REVIEW").length;
  el("tab-inbox-count").textContent = state.stats.total;
  el("tab-review-count").textContent = escalations;
  // The queue tab only flags for attention while something is actually queued.
  el("tab-review").classList.toggle("attn", escalations > 0);
  station("ok", `Run loaded · ${state.stats.total} records`);

  applyRoute();
}

boot();
