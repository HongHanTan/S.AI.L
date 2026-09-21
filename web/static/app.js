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
  // Guards must be boolean: `list.length && node` passes the NUMBER 0 through
  // when the list is empty, and 0 is a legitimate child, so it would render as
  // a stray "0". Write `list.length > 0 && node` instead.
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
function icon(shapes, size = 15, stroke = 2) {
  const root = document.createElementNS(SVG_NS, "svg");
  for (const [key, value] of Object.entries(ICON_ATTRS)) root.setAttribute(key, value);
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  root.setAttribute("stroke-width", String(stroke));
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

// Lucide-shaped glyphs, all on the same 24x24 grid so they optically match at
// any size. Drawn through createElementNS like everything else in this file.
const P = (d) => ["path", { d }];

const BOX = [
  P("m7.5 4.27 9 5.15"),
  P("M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"),
  P("m3.3 7 8.7 5 8.7-5"), P("M12 22V12"),
];
const INBOX = [
  P("M22 12h-6l-2 3h-4l-2-3H2"),
  P("M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"),
];
const DOC = [
  P("M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"),
  P("M14 2v4a2 2 0 0 0 2 2h4"),
];
const FILE_CHECK = [...DOC, P("m9 15 2 2 4-4")];
/* A document being diffed: plus over minus. */
const FILE_DIFF = [...DOC, P("M12 12v4"), P("M10 14h4"), P("M10 18h4")];
/* A document going out. */
const FILE_OUT = [...DOC, P("M12 18v-6"), P("m9 15 3-3 3 3")];
const RECEIPT = [
  P("M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"),
  P("M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"), P("M12 17.5v-11"),
];
const MAIL = [
  ["rect", { x: 2, y: 4, width: 20, height: 16 }],
  P("m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"),
];
const SHIELD_ALERT = [
  P("M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"),
  P("M12 8v4"), P("M12 16h.01"),
];
const ALERT_TRIANGLE = [
  P("m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"),
  P("M12 9v4"), P("M12 17h.01"),
];
const USER_ALERT = [
  P("M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"),
  ["circle", { cx: 9, cy: 7, r: 4 }], P("M20 8v4"), P("M20 16h.01"),
];
const BAR_CHART = [P("M3 3v16a2 2 0 0 0 2 2h16"), P("M7 16v-3"), P("M12 16V8"), P("M17 16v-6")];
const LAYERS = [
  P("M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"),
  P("m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59"),
];
const ACTIVITY = [P("M22 12h-4l-3 9L9 3l-3 9H2")];
const CIRCLE_ALERT = [["circle", { cx: 12, cy: 12, r: 10 }], P("M12 8v4"), P("M12 16h.01")];
const CIRCLE_CHECK = [P("M21.8 10A10 10 0 1 1 17 3.34"), P("m9 11 3 3L22 4")];
const CHECK = [P("M20 6 9 17l-5-5")];
const XMARK = [P("M18 6 6 18"), P("m6 6 12 12")];
const ARROW_LEFT = [P("m12 19-7-7 7-7"), P("M19 12H5")];
const ARROW_RIGHT = [P("m12 5 7 7-7 7"), P("M5 12h14")];
const GRID = [
  ["rect", { x: 3, y: 3, width: 7, height: 7 }], ["rect", { x: 14, y: 3, width: 7, height: 7 }],
  ["rect", { x: 14, y: 14, width: 7, height: 7 }], ["rect", { x: 3, y: 14, width: 7, height: 7 }],
];
const COLUMNS = [
  ["rect", { x: 3, y: 3, width: 18, height: 18 }], P("M9 3v18"), P("M15 3v18"),
];
const TRASH = [
  P("M3 6h18"), P("M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"),
  P("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"), P("M10 11v6"), P("M14 11v6"),
];
const PAPERCLIP = [
  P("m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"),
];
const SEND = [
  P("M14.54 21.69a.5.5 0 0 0 .93-.03l6.5-19a.5.5 0 0 0-.63-.63l-19 6.5a.5.5 0 0 0-.03.93l7.93 3.18a2 2 0 0 1 1.11 1.11z"),
  P("m21.85 2.15-10.94 10.94"),
];
/* Reset, not delete: the form comes back empty, nothing is destroyed. */
const ROTATE = [P("M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"), P("M3 3v5h5")];
const LIST_CHECK = [
  P("m3 17 2 2 4-4"), P("m3 7 2 2 4-4"), P("M13 6h8"), P("M13 12h8"), P("M13 18h8"),
];

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

// A glyph per lane, so the five columns are told apart by shape before the
// reader has parsed the enum. Keyed on the enum itself, not on lane order.
const CATEGORY_ICON = {
  BL_COMPARISON: () => FILE_DIFF,
  SI_REQUEST: () => FILE_OUT,
  INVOICE_QUERY: () => RECEIPT,
  GENERAL: () => MAIL,
  SPAM: () => SHIELD_ALERT,
};

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
  routing: null,       // the hash pushRoute last set, awaiting its echo
  // Where "Back to Board" returns to, and the scroll offsets to put back.
  origin: { view: "inbox", status: "", reason: "" },
  category: "",      // board focused on one category, "" = all five lanes
  scroll: { stacks: [], list: 0 },
  queue: null, reviewId: null,
  pendingDetail: null,   // an #/email/:id landed before the list did
  senders: new Map(),   // email_id -> from, filled lazily for the overview
  reviewRecs: new Map(),// email_id -> full record, for the queue's right pane
  detailId: null,
  boardKey: null,
};

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} responded ${response.status}`);
  return response.json();
}

const dataReady = () => Array.isArray(state.emails);

/** A skeleton shaped like the Overview rather than four anonymous bars, so a
 *  cold load reads as loading instead of as empty broken containers. */
function overviewSkeleton() {
  const sk = (cls) => h("span", { class: `sk ${cls}` });
  const card = () => h("div", { class: "kpi sk-card" },
    sk("sk-i"), sk("sk-b"), sk("sk-l"), sk("sk-n"));
  const panel = () => h("section", { class: "ins" },
    h("header", { class: "ins-h" }, sk("sk-h"), sk("sk-p")),
    h("div", { class: "ins-b" }, sk("sk-r"), sk("sk-r"), sk("sk-r")));
  return h("div", { class: "ov", "aria-busy": "true" },
    h("h2", { class: "ov-h", text: "Operations summary" }),
    h("div", { class: "kpi-grid" }, [0, 1, 2, 3].map(card)),
    h("h2", { class: "ov-h", text: "How the run decided" }),
    h("div", { class: "ins-grid three" }, [0, 1, 2].map(panel)),
    h("h2", { class: "ov-h", text: "What needs attention" }),
    h("div", { class: "ins-grid" }, [0, 1].map(panel)));
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
    dataset: { cat: rec.category },
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
    board.append(h("section", {
      class: `lane${key === "BL_COMPARISON" ? " key" : ""}`, dataset: { cat: key } },
      h("div", { class: "lane-h" },
        h("h2", { class: "lane-title" },
          // Icon and name travel together; the count stays pinned right so the
          // five totals can be read straight down one column.
          h("span", { class: "lane-name" },
            h("span", { class: "lane-icon", "aria-hidden": "true" },
              icon((CATEGORY_ICON[key] || (() => BOX))(), 15, 1.75)),
            h("span", { class: "enum", text: key }),
            key === "BL_COMPARISON"
              && h("span", { class: "hero-lane-pill", text: "PRIMARY DESK" })),
          h("span", { class: "lane-count", text: rows.length })),
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
      ? (REASON_LABEL[rec.review_reason] || "Needs review")
      : rec.status === "MISMATCH" ? "Mismatch found" : "Cleared";

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

  // Column labels on the same grid as .row, so they sit over their columns.
  // They stick while rows scroll under them; the count banner above does not,
  // so it scrolls away and leaves the header flush with the top.
  const columns = h("div", { class: "list-head", "aria-hidden": "true" },
    h("span", { text: "STATUS / REASON" }),
    h("span", { text: "BOOKING REF" }),
    h("span", { text: "PIPELINE FINDINGS" }),
    h("span", { class: "th-id", text: "CASE ID" }));

  const list = h("div", { class: "list" }, head, columns);
  if (rows.length) list.append(...rows.map(worklistRow));
  else list.append(h("p", { class: "empty", text: "Nothing here." }));

  fill(el("inbox"), list);
  el("inbox").dataset.key = `list:${cacheKey}:${state.reason}`;
}

// ---------------------------------------------------------------------------
// Overview workspace
// ---------------------------------------------------------------------------

function kpi(value, label, note, flavour, glyph) {
  return h("div", { class: `kpi ${flavour || ""}`.trim() },
    h("span", { class: "kpi-i", "aria-hidden": "true" }, icon(glyph, 18, 1.75)),
    h("b", { text: value }),
    h("span", { class: "kpi-l", text: label }),
    h("span", { class: "kpi-n", text: note }));
}

/** Shared chrome for the analysis panels, so they read as one instrument.
 *  `badge` is a short count anchoring the right of the header; anything longer
 *  belongs in a caption(), under the chart it describes. */
function insight(glyph, title, badge, ...body) {
  return h("section", { class: "ins" },
    h("header", { class: "ins-h" },
      h("h3", {},
        h("span", { class: "ins-i", "aria-hidden": "true" }, icon(glyph, 18, 1.75)),
        title),
      badge && h("span", { class: "ins-badge", text: badge })),
    ...body.filter(Boolean));
}

const caption = (text) => h("p", { class: "ins-cap", text });

/** A legend row shared by the stacked bar and the band chart. */
const keyRow = (items) => h("ul", { class: "keys" },
  items.filter(([, n]) => n !== null).map(([label, n, flavour]) => h("li", { class: flavour || "" },
    h("span", { class: "key-n", text: n }),
    h("span", { class: "key-l", text: label }))));

/** Where the 195 comparisons actually ended up.
 *
 *  Deliberately four segments, not three. 66 of the 130 OK records carry zero
 *  verdicts and the note "no documents attached and none claimed" — folding
 *  them into "all seven matched" would claim a comparison the pipeline never
 *  ran. They get their own neutral segment instead.
 */
function outcomeBar(bl) {
  const ok = bl.filter((e) => e.status === "OK");
  // Within OK the attachment count separates cleanly -- all 66 records with no
  // attachment have no verdicts, and all 64 with attachments have all seven.
  // The list endpoint omits verdicts, so this is the signal available here.
  const matched = ok.filter((e) => e.attachment_count > 0).length;
  const nothing = ok.length - matched;
  const differs = bl.filter((e) => e.status === "MISMATCH").length;
  const human = bl.filter((e) => e.status === "NEEDS_REVIEW").length;
  const total = bl.length || 1;
  const seg = (n, flavour) => n > 0 && h("i", { class: flavour, style: `width:${(n / total) * 100}%` });

  return insight(CIRCLE_CHECK, "Outcome of each check",
    `${bl.length} shipments`,
    h("div", { class: "ins-b" },
      h("div", { class: "stack-bar", role: "img",
        "aria-label": `${matched} matched, ${differs} differ, ${human} sent to a human, `
          + `${nothing} had nothing to compare` },
        seg(matched, "c"), seg(differs, "m"), seg(human, "r"), seg(nothing, "z")),
      keyRow([
        ["Compared, all matched", matched, "c"],
        ["At least one differs", differs, "m"],
        ["Sent to a human", human, "r"],
        ["Nothing to compare", nothing, "z"],
      ]),
      caption(`${nothing} of the ${ok.length} cleared records carried no documents, `
        + "so they were never compared at all.")));
}

/** Give a panel a stable handle so a late payload can swap just that panel. */
const tag = (node, id) => { node.id = id; return node; };

/** A panel whose data has not arrived yet. Distinct from an empty panel: one
 *  is waiting, the other is a finding. */
const pendingPanel = (glyph, title) => insight(glyph, title, null,
  h("div", { class: "ins-b" }, skeleton(3)), caption("Loading…"));

/** Which rung settled each field comparison. Straight off /api/stats, which
 *  already walks every verdict, so this costs no extra request. */
function decisionLayers(stats) {
  if (!stats) return tag(pendingPanel(LAYERS, "Decision layers"), "ins-layers");
  const layers = (stats && stats.layers) || {};
  const ranked = Object.keys(LAYER_LABEL)
    .map((key) => [key, layers[key] || 0])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const worst = ranked.length ? ranked[0][1] : 0;
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);

  return tag(insight(LAYERS, "Decision layers",
    total ? `${total} comparisons` : null,
    h("ul", { class: "bars tight" }, ranked.map(([key, n]) => h("li", { class: "bar" },
      h("span", { class: "bar-k", text: key }),
      h("span", { class: "bar-t" },
        h("i", { class: "accent", style: `width:${worst ? Math.round((n / worst) * 100) : 0}%` })),
      h("span", { class: "bar-n", text: n }),
      h("span", { class: "bar-p", text: LAYER_LABEL[key] })))),
    caption("An earlier rung is cheaper and more certain: gate1 never involves a "
      + "model, L4 always does.")), "ins-layers");
}

/** L3 scores against the two thresholds the comparison actually ran at.
 *
 *  Three bands rather than a histogram: only 52 of 798 verdicts are scored at
 *  all, and they hold six distinct values clustered at the extremes. Twenty
 *  buckets would be seventeen empty ones. The thresholds come from the API so
 *  the chart cannot drift from similarity.py.
 */
function similarityBands(stats) {
  if (!stats) return tag(pendingPanel(ACTIVITY, "Similarity scores"), "ins-similarity");
  const sim = stats && stats.similarity;
  if (!sim || !sim.scored) {
    return tag(insight(ACTIVITY, "Similarity scores", "No field reached the similarity rung.",
      h("p", { class: "empty", text: "Nothing scored." })), "ins-similarity");
  }
  const lo = sim.different_at, hi = sim.same_at;
  const bands = sim.bands || {};
  const rows = [
    ["DIFFERENT", bands.DIFFERENT || 0, "m", `≤ ${lo}`],
    ["GRAY", bands.GRAY || 0, "r", `${lo} – ${hi}`],
    ["SAME", bands.SAME || 0, "c", `≥ ${hi}`],
  ];
  const total = sim.scored || 1;

  return tag(insight(ACTIVITY, "Similarity scores",
    `${sim.scored} evaluated · L3`,
    h("div", { class: "ins-b" },
      h("div", { class: "band" }, rows.map(([name, n, flavour, range]) =>
        h("div", { class: `band-row ${flavour}${n ? "" : " zero"}` },
          h("span", { class: "band-k", text: name }),
          h("span", { class: "band-t" },
            h("i", { style: `width:${Math.round((n / total) * 100)}%` })),
          h("span", { class: "band-n", text: n }),
          h("span", { class: "band-r", text: range })))),
      // An empty gray band is the finding, not a rendering gap.
      h("p", { class: "ins-cap",
        text: (bands.GRAY || 0) === 0
          ? "Nothing landed in the gray band, so no field needed model adjudication."
          : `${bands.GRAY} field${bands.GRAY === 1 ? "" : "s"} fell in the gray band.` }))),
    "ins-similarity");
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

  return insight(BAR_CHART, "Field discrepancy breakdown",
    flagged.length ? `${total} defect${total === 1 ? "" : "s"}` : null,
    flagged.length
      ? h("ul", { class: "bars" },
          h("li", { class: "bar head" },
            h("span", { class: "bar-k", text: "FIELD" }),
            h("span", {}),
            h("span", { class: "bar-n", text: "N" }),
            h("span", { class: "bar-p", text: "SHARE" })),
          ranked.map(row))
      : h("p", { class: "empty", text: "Nothing to break down." }),
    flagged.length
      && caption(`Across ${flagged.length} flagged shipments; each share is of those `
        + `${flagged.length}, not of the ${total} defects.`));
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

  return insight(CIRCLE_ALERT, "Escalation root causes",
    escalations.length ? `${escalations.length} held` : null,
    h("div", { class: "causes" }, ranked.map(row)),
    caption(escalations.length
      ? "Open a cause to see just those tickets on the board."
      : "Nothing is waiting on a person."));
}

const ESCALATION_PREVIEW = 5;

/** The sender is on the detail endpoint only — the list and the queue both
 *  omit it. Rather than widen a backend contract for one column, the preview
 *  fetches it for the handful of shipments actually on screen and patches the
 *  cells when it lands. Nothing else on the row waits for it, and a failure
 *  degrades to an em-dash instead of blanking the table.
 */
async function loadSenders(ids) {
  const wanted = ids.filter((id) => !state.senders.has(id));
  // Awaited even when empty: the caller is still building the table, so the
  // patch below has to land after fill() has put it in the document.
  await Promise.all(wanted.map(async (id) => {
    try {
      const rec = await api(`/api/emails/${encodeURIComponent(id)}`);
      state.senders.set(id, rec.from || "");
    } catch {
      state.senders.set(id, "");
    }
  }));
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
      h("button", { class: "act ghost sm", type: "button",
        onclick: () => openReview(rec.email_id) },
        "Review ",
        h("span", { class: "arw", "aria-hidden": "true", text: "→" }))));

  const table = h("table", { class: "esc" },
    h("thead", {}, h("tr", {},
      h("th", { text: "Booking ref" }),
      h("th", { text: "Port / route" }),
      h("th", { text: "Review reason" }),
      h("th", { class: "e-from", text: "Sender" }),
      h("th", { class: "e-act", text: "Action" }))),
    h("tbody", {}, preview.map(row)));

  loadSenders(preview.map((rec) => rec.email_id));

  return insight(LIST_CHECK, "Active escalations queue",
    `Top ${preview.length} of ${escalations.length}`,
    table,
    escalations.length > preview.length
      && h("footer", { class: "ins-f" },
        h("button", { class: "act cta", type: "button", onclick: () => go("review") },
          `Open the full queue of ${escalations.length} `,
          h("span", { class: "arw", "aria-hidden": "true", text: "→" }))));
}

function renderOverview() {
  if (!dataReady()) { fill(el("overview"), overviewSkeleton()); return; }

  const bl = state.emails.filter(isComparison);
  const flagged = bl.filter((e) => e.status === "MISMATCH");
  const escalations = bl.filter((e) => e.status === "NEEDS_REVIEW");

  const grid = h("div", { class: "kpi-grid" },
    kpi(state.emails.length, "Total triaged", "Emails classified end to end", "", INBOX),
    kpi(bl.length, "BL comparison", "Routed to active verification", "", FILE_CHECK),
    kpi(flagged.length, "Discrepancies", "Field mismatches caught", "m", ALERT_TRIANGLE),
    kpi(escalations.length, "Human escalation", "Held for a person to resolve", "r", USER_ALERT));

  // One 6-column grid for both analysis bands, so their outer edges line up
  // even though one splits 2/2/2 and the other 3/3.
  const howItDecided = h("div", { class: "ins-grid three" },
    outcomeBar(bl), decisionLayers(state.stats), similarityBands(state.stats));

  const whatNeedsAttention = h("div", { class: "ins-grid" },
    fieldBreakdown(flagged), rootCauses(escalations));

  fill(el("overview"),
    h("div", { class: "ov" },
      h("h2", { class: "ov-h", text: "Operations summary" }),
      grid,
      h("h2", { class: "ov-h", text: "How the run decided" }),
      howItDecided,
      h("h2", { class: "ov-h", text: "What needs attention" }),
      whatNeedsAttention,
      escalations.length > 0 && escalationTable(escalations)));
}

/** The list has arrived. Update everything that reads it and re-render the
 *  workspace that is currently on screen, whichever one that is. Without this
 *  last step a cold reload would sit on its skeleton until the user changed
 *  tabs, because nothing else re-invokes the active view's renderer.
 */
function mountEmails() {
  const bl = state.emails.filter(isComparison);
  const escalations = bl.filter((e) => e.status === "NEEDS_REVIEW").length;
  // Counted off the list, not off stats, so the tabs do not wait on stats.
  el("tab-inbox-count").textContent = state.emails.length;
  el("tab-review-count").textContent = escalations;
  // The queue tab only flags for attention while something is actually queued.
  el("tab-review").classList.toggle("attn", escalations > 0);
  station("ok", `Run loaded · ${state.emails.length} records`);

  // The board caches by key; clear it so the skeleton cannot be mistaken for
  // an already-built board.
  delete el("inbox").dataset.key;
  applyRoute();
}

/** Swap in the two panels that were waiting on /api/stats, leaving the rest of
 *  the workspace alone. Re-rendering everything would also restart the sender
 *  fetch and discard the cells it was about to fill. */
function paintStatsPanels() {
  const layers = el("ins-layers");
  const bands = el("ins-similarity");
  if (layers) layers.replaceWith(decisionLayers(state.stats));
  if (bands) bands.replaceWith(similarityBands(state.stats));
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

/** The list the reader arrived from, so Previous/Next walk that order rather
 *  than the whole 520. Falls back to everything if the record is not in it. */
function detailPool(rec) {
  const origin = state.origin || {};
  const all = state.emails || [];
  let pool = all;
  if (origin.category) {
    pool = all.filter((e) => e.category === origin.category);
  } else if (origin.status) {
    pool = all.filter((e) => isComparison(e) && e.status === origin.status
      && (!origin.reason || e.review_reason === origin.reason));
  }
  return pool.some((e) => e.email_id === rec.email_id) ? pool : all;
}

function detailNav(rec) {
  const pool = detailPool(rec);
  const at = pool.findIndex((e) => e.email_id === rec.email_id);
  const step = (delta) => (at < 0 ? null : pool[at + delta] || null);

  const button = (target, label, glyph, leading) => {
    const mark = h("span", { class: "act-i", "aria-hidden": "true" }, icon(glyph, 14, 1.75));
    return h("button", {
      class: "act quiet", type: "button", disabled: !target,
      title: target
        ? `${label}: ${bookingRef(target.subject) || target.email_id}`
        : `No ${label.toLowerCase()} ticket in this list`,
      onclick: () => { if (target) openDetail(target, null); },
    }, ...(leading ? [mark, label] : [label, mark]));
  };

  return [
    button(step(-1), "Previous", ARROW_LEFT, true),
    h("span", { class: "nav-pos",
      text: at < 0 ? "" : `${at + 1} of ${pool.length}` }),
    button(step(1), "Next", ARROW_RIGHT, false),
  ];
}

/** The actions a ticket's own lifecycle allows.
 *
 *  Nothing here changes a record's status, because no endpoint does. What the
 *  API supports is per-field human confirmation, and that only makes sense on
 *  the escalations a person was actually asked to settle:
 *
 *    nothing compared   -> no field-level action exists
 *    MISMATCH           -> the run already decided these differ; the header
 *                          states the consequence instead of offering a button
 *                          that would wave it through
 *    NEEDS_REVIEW       -> sign-off, posting every pair to /api/review as SAME
 *    OK                 -> already settled, nothing to do
 */
function detailActions(rec) {
  const verdicts = rec.verdicts || [];
  const mark = (glyph) => h("span", { class: "act-i", "aria-hidden": "true" }, icon(glyph, 14, 1.75));
  // Only BL_COMPARISON runs a comparison at all, so nothing else can have a
  // field-level action even in principle.
  if (!isComparison(rec) || verdicts.length === 0) return [];

  if (rec.status === "MISMATCH") {
    const defects = (rec.defect_fields || []).length;
    return [h("span", { class: "act-flag", role: "status" },
      mark(ALERT_TRIANGLE),
      defects
        ? `Amendment required — ${defects} field${defects === 1 ? "" : "s"} differ`
        : "Amendment required")];
  }

  if (rec.status !== "NEEDS_REVIEW") return [];

  const note = h("span", { class: "act-note" });
  const approve = h("button", {
    class: "act go", type: "button",
    title: `Record all ${verdicts.length} compared pairs as the same entity`,
  }, mark(CHECK), "Approve all fields");

  approve.addEventListener("click", async () => {
    approve.disabled = true;
    note.className = "act-note";
    note.textContent = "Recording…";
    try {
      await Promise.all(verdicts.map((v) => api(
        `/api/review/${encodeURIComponent(rec.email_id)}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ field: v.field_name, verdict: "SAME" }) })));
      note.className = "act-note ok";
      note.textContent = `${verdicts.length} confirmations recorded — they enter `
        + "the alias table at the next promotion.";
    } catch (err) {
      approve.disabled = false;
      note.className = "act-note bad";
      note.textContent = err.message;
    }
  });

  return [approve, note];
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

  fill(el("detail-nav"), detailNav(rec));
  fill(el("detail-actions"), detailActions(rec));

  fill(el("detail-why"), [whyBlock(rec)].filter(Boolean));
  fill(el("detail-summary"), summaryRows(rec));

  // Most NEEDS_REVIEW records stop before extraction and carry no verdicts at
  // all, so the table hides rather than showing an empty frame.
  const verdicts = rec.verdicts || [];
  // Two columns exist to hold a comparison beside its context. Anything that
  // never ran one -- another category, or a gate that stopped before
  // extraction -- flows top to bottom instead.
  const solo = !isComparison(rec) || verdicts.length === 0;
  el("report").hidden = solo;
  el("detail").classList.toggle("solo", solo);
  el("detail-body").classList.toggle("solo", solo);
  // Promoted out of the overview card so the callout leads the stacked page,
  // and put back inside it when the two-column shape returns.
  const why = el("detail-why");
  const overviewPanel = el("detail-summary").parentNode;
  if (solo) document.querySelector("#detail .col-left").prepend(why);
  else overviewPanel.insertBefore(why, el("detail-summary"));
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
  el("original-body").classList.toggle("is-empty", !hasBody);
  if (hasBody) {
    highlight(el("original-body"), rec.body);
  } else {
    fill(el("original-body"),
      h("span", { class: "raw-i", "aria-hidden": "true" }, icon(INBOX, 22, 1.5)),
      h("span", { class: "muted", text: "(no body recorded for this email)" }),
      h("span", { class: "muted small",
        text: "The deployed app ships only run.json; bodies come from the organiser bundle." }));
  }
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
    state.origin = { view: state.view, status: state.status, reason: state.reason,
      category: state.category };
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

  // Neutral at rest -- the desk should not suggest an answer -- but each
  // carries its own glyph, and takes its colour on hover once the pointer has
  // already committed to one.
  for (const [choice, label, flavour, glyph] of [
    ["SAME", "Same entity", "yes", CHECK],
    ["DIFFERENT", "Different", "no", XMARK],
  ]) {
    const button = h("button", { class: `act ${flavour}`, type: "button" },
      h("span", { class: "act-i", "aria-hidden": "true" }, icon(glyph, 14, 2)),
      label);
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

/** The original email, as its own panel. Shared shape with the detail page so
 *  a reader sees the same evidence laid out the same way in both places. */
function originalPanel(rec) {
  const hasBody = typeof rec.body === "string" && rec.body !== "";
  const box = h("pre", { class: `raw${hasBody ? "" : " is-empty"}` });
  if (hasBody) {
    highlight(box, rec.body);
  } else {
    fill(box,
      h("span", { class: "raw-i", "aria-hidden": "true" }, icon(INBOX, 22, 1.5)),
      h("span", { class: "muted", text: "(no body recorded for this email)" }),
      h("span", { class: "muted small",
        text: "The deployed app ships only run.json; bodies come from the organiser bundle." }));
  }

  const names = rec.attachment_names || [];
  return h("section", { class: "panel" },
    h("h3", { text: "Original email" }),
    h("dl", {},
      h("dt", { text: "From" }), h("dd", { text: rec.from || "—" }),
      h("dt", { text: "Subject" }), h("dd", { text: rec.subject || "(no subject)" }),
      h("dt", { text: "Attachments" }),
      h("dd", { text: rec.attachment_count
        ? `${rec.attachment_count} file${rec.attachment_count === 1 ? "" : "s"} received`
        : "None received" })),
    box,
    hasBody && h("div", { class: "lg" },
      h("span", {}, h("i", { class: "a" }), "Check request"),
      h("span", {}, h("i", { class: "b" }), "Problem signal"),
      h("span", {}, h("i", { class: "c2" }), "Document named")),
    names.length > 0 && h("ul", { class: "fl" }, names.map((n) => h("li", { text: n }))));
}

/** The comparison table, with its evidence legend. */
function comparisonPanel(rec) {
  const verdicts = rec.verdicts || [];
  return h("section", { class: "panel" },
    h("h3", { text: "Field comparison" }),
    h("div", { class: "table-wrap" },
      h("table", { class: "cmp" },
        h("thead", {}, h("tr", {},
          h("th", { scope: "col", class: "c-field", text: "Field" }),
          h("th", { scope: "col", class: "c-si", text: "SI (reference)" }),
          h("th", { scope: "col", class: "c-bl", text: "Draft BL" }),
          h("th", { scope: "col", class: "c-by", text: "Decided by" }))),
        h("tbody", {}, comparisonRows(verdicts, rec.defect_fields || [])))),
    h("p", { class: "legend" },
      h("b", { text: "Decided by" }),
      " names the rung that settled the field: an earlier rung is cheaper and "
      + "more certain than a later one."));
}

/** The whole record, inline. Nothing here links away: this pane is the work
 *  surface, so the evidence a decision needs is on it.
 *
 *  The shape follows the record. Fifteen of the eighteen escalations stop at a
 *  document gate and never reach extraction, so for those there is no second
 *  column to fill and the record stacks instead of sitting beside a hole.
 */
function reviewPane(item, rec) {
  const ref = bookingRef(item.subject) || item.email_id;
  const verdicts = (rec && rec.verdicts) || item.verdicts || [];
  const compared = (!rec || isComparison(rec)) && verdicts.length > 0;
  const actions = rec ? detailActions(rec) : [];

  const head = h("header", { class: "rq-bar" },
    h("div", { class: "rq-bar-in" },
    h("div", { class: "rq-ident" },
      h("h3", { class: "bk3", text: ref }),
      h("p", { class: "subj", text: item.subject || "(no subject)" })),
    h("div", { class: "detail-side" },
      h("div", { class: "detail-pills" },
        rec && h("span", { class: "pill mono",
          title: CATEGORY_LABEL[rec.category] || "", text: rec.category }),
        rec && rec.status
          && h("span", { class: `pill mono ${tone(rec)}`.trim(), text: rec.status }),
        item.review_reason && h("span", { class: "pill mono r", text: item.review_reason }),
        h("span", { class: "pill mono", text: item.email_id })),
      actions.length > 0 && h("div", { class: "detail-actions" }, actions))));

  if (!rec) return [head, h("div", { class: "rq-cols solo" }, skeleton(4))];

  const why = whyBlock(rec);
  const overview = h("section", { class: "panel" },
    h("h3", { text: "Case overview" }),
    // In the stacked shape the callout is promoted out of this panel and runs
    // the full width, so it is not duplicated here.
    compared && why,
    h("dl", { class: "sum" }, summaryRows(rec)),
    ...(rec.notes || []).map((n) => h("p", { class: "note", text: n })));

  if (!compared) {
    return [head, h("div", { class: "rq-cols solo" },
      why && h("div", { class: "rq-alert" }, why),
      overview,
      originalPanel(rec))];
  }

  return [head, h("div", { class: "rq-cols" },
    h("div", { class: "rq-col" }, overview, originalPanel(rec)),
    h("div", { class: "rq-col" },
      comparisonPanel(rec),
      h("section", { class: "panel" },
        h("h3", { text: "Settle a field" }),
        ...verdicts.map((v) => judgeBlock(item, v)))))];
}

function paintReviewSelection() {
  const pane = el("rq-pane");
  if (!pane) return;
  // The highlight moves first and synchronously, whatever the network does.
  for (const row of document.querySelectorAll(".rq-row")) {
    row.classList.toggle("on", row.dataset.id === state.reviewId);
  }
  const item = (state.queue || []).find((q) => q.email_id === state.reviewId);
  if (!item) {
    fill(pane, h("p", { class: "empty",
      text: "Select an escalation to see why it stopped and settle its fields." }));
    return;
  }

  const cached = state.reviewRecs.get(item.email_id);
  pane.classList.toggle("solo", !!cached && !(isComparison(cached)
    && (cached.verdicts || []).length > 0));
  fill(pane, reviewPane(item, cached || null));
  pane.scrollTop = 0;
  if (cached) return;

  // The queue payload has no sender, body, attachments, category or status, so
  // the full record is fetched once per ticket and kept.
  const wanted = item.email_id;
  api(`/api/emails/${encodeURIComponent(wanted)}`).then((rec) => {
    state.reviewRecs.set(wanted, rec);
    if (state.reviewId !== wanted) return;
    pane.classList.toggle("solo",
      !(isComparison(rec) && (rec.verdicts || []).length > 0));
    fill(pane, reviewPane(item, rec));
    pane.scrollTop = 0;
  }).catch(() => {
    if (state.reviewId !== wanted) return;
    fill(pane, reviewPane(item, null)[0],
      notice("The full record could not be loaded.", null));
  });
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

/** Bytes, at the precision a person actually reads. */
function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderCompare() {
  if (el("compare").dataset.ready) return;
  el("compare").dataset.ready = "1";

  const field = (id, label, node) => h("div", {}, h("label", { for: id, text: label }), node);
  const glyph = (shapes, size = 14) =>
    h("span", { class: "act-i", "aria-hidden": "true" }, icon(shapes, size, 1.75));

  const from = h("input", { class: "field", type: "text", id: "cmp-from",
    placeholder: "docs@vitalsolutions.sg" });
  const subject = h("input", { class: "field", type: "text", id: "cmp-subject",
    placeholder: "TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI" });
  const body = h("textarea", { class: "field", id: "cmp-body", rows: 8,
    placeholder: "Hi,\n\nAttached are the SI and draft BL. Please check the details and confirm.\n\nThanks" });
  // Kept in the DOM and focusable, but out of sight: the visible control is the
  // button below, so the picker can sit next to a real list of what was picked.
  const files = h("input", { class: "sr", type: "file", id: "cmp-files", multiple: true });
  const hint = h("span", { class: "hint" });
  const out = h("div", { class: "try-out", id: "cmp-out" });

  const blank = () => fill(out, h("p", { class: "try-empty",
    text: "Nothing processed yet. Write an email, or load an example, then press Process." }));
  blank();

  // An <input type=file> has a read-only FileList, so there is no way to drop
  // one entry from it. The app keeps its own array instead and builds the
  // upload from that; the input is only ever a source of new files, and is
  // reset after every pick so the same file can be chosen again.
  let picked = [];
  const bin = h("div", { class: "filebin" });

  const renderFiles = () => {
    fill(bin, picked.length
      ? h("ul", { class: "filelist" }, picked.map((file, index) => h("li", {},
          h("span", { class: "fl-n", text: file.name }),
          h("span", { class: "fl-s", text: fileSize(file.size) }),
          h("button", { class: "icon-btn", type: "button",
            title: `Remove ${file.name}`, "aria-label": `Remove ${file.name}`,
            onclick: () => { picked.splice(index, 1); renderFiles(); sync(); } },
            icon(TRASH, 14, 1.75)))))
      : h("p", { class: "fl-empty", text: "No attachments. The pipeline still runs without them." }));
    count.textContent = picked.length
      ? `${picked.length} file${picked.length === 1 ? "" : "s"}` : "";
  };

  const count = h("span", { class: "fl-count" });
  const pick = h("button", { class: "act", type: "button", onclick: () => files.click() },
    glyph(PAPERCLIP), "Choose files");

  files.addEventListener("change", () => {
    for (const file of files.files) {
      // Same name and size twice over is a double-pick, not two documents.
      if (!picked.some((p) => p.name === file.name && p.size === file.size)) picked.push(file);
    }
    files.value = "";          // so re-picking the same file still fires change
    renderFiles();
    sync();
  });

  const run = h("button", { class: "act primary", type: "button" },
    glyph(SEND), "Process email");
  const clear = h("button", { class: "act quiet", type: "button" },
    glyph(ROTATE), "Clear");

  // Clear is only live when there is something to clear, so the control tells
  // you the state of the form before you press it.
  const dirty = () => Boolean(from.value || subject.value || body.value
    || picked.length || out.querySelector(".result, .notice"));
  const sync = () => { clear.disabled = !dirty(); };
  for (const input of [from, subject, body]) input.addEventListener("input", sync);

  clear.addEventListener("click", () => {
    for (const input of [from, subject, body]) input.value = "";
    picked = [];
    files.value = "";
    hint.textContent = "";
    renderFiles();
    blank();
    sync();
    from.focus();
  });

  const loadExample = (key) => () => {
    from.value = EXAMPLES[key].from;
    subject.value = EXAMPLES[key].subject;
    body.value = EXAMPLES[key].body;
    hint.textContent = EXAMPLES[key].hint;
    blank();
    sync();
  };

  run.addEventListener("click", async () => {
    if (!subject.value.trim() && !body.value.trim()) {
      hint.textContent = "Write a subject or a body first.";
      return;
    }
    run.disabled = true;
    run.classList.add("busy");
    hint.textContent = "Processing…";
    fill(out, skeleton(3));

    const form = new FormData();
    form.append("subject", subject.value);
    form.append("body", body.value);
    form.append("sender", from.value);
    for (const file of picked) form.append("files", file);

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
      run.classList.remove("busy");
      sync();
    }
  });

  renderFiles();
  sync();

  const compose = h("section", { class: "ins" },
    h("header", { class: "ins-h col" },
      h("h3", {},
        h("span", { class: "ins-i", "aria-hidden": "true" }, icon(FILE_OUT, 18, 1.75)),
        "Compose"),
      h("p", { class: "ins-sub",
        text: "You never say which attachment is the Shipping Instruction and which "
        + "is the draft Bill of Lading — each document's own header decides, because in "
        + "real inboxes filenames lie." })),
    h("div", { class: "try-form" },
      field("cmp-from", "FROM", from),
      field("cmp-subject", "SUBJECT", subject),
      field("cmp-body", "BODY", body),
      h("div", {},
        h("label", { for: "cmp-files", text: "ATTACHMENTS (OPTIONAL, ANY ORDER)" }),
        files,
        h("div", { class: "fl-pick" }, pick, count),
        bin),
      h("div", { class: "try-examples" },
        h("span", { class: "try-lbl", text: "LOAD AN EXAMPLE" }),
        h("button", { class: "act ghost sm", type: "button", onclick: loadExample("comparison") },
          glyph(FILE_DIFF, 13), "Comparison email"),
        h("button", { class: "act ghost sm", type: "button", onclick: loadExample("spam") },
          glyph(SHIELD_ALERT, 13), "Spam email"))),
    h("footer", { class: "try-acts" }, run, clear, hint));

  const result = h("section", { class: "ins" },
    h("header", { class: "ins-h col" },
      h("h3", {},
        h("span", { class: "ins-i", "aria-hidden": "true" }, icon(ACTIVITY, 18, 1.75)),
        "Pipeline result"),
      h("p", { class: "ins-sub",
        text: "Classification, document typing, extraction, comparison and rollup — "
        + "the same code path the 520-email batch run uses." })),
    out);

  fill(el("compare"),
    h("div", { class: "try" },
      h("header", { class: "try-h" },
        h("h2", {},
          h("span", { class: "ins-i", "aria-hidden": "true" }, icon(SEND, 16, 1.75)),
          "Try an email"),
        h("p", { text: "Write an email the way a customer would and attach whatever documents "
          + "it would carry — or none at all." })),
      h("div", { class: "try-grid" }, compose, result)));
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
  state.routing = next;
  location.hash = next;
}

/** Parse the hash into state. Pure: touches no data and fetches nothing, so
 *  it can run on the first frame and put the right panel and tab on screen
 *  before a single request goes out. */
function readRoute() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  state.pendingDetail = null;

  if (parts[0] === "email" && parts[1]) {
    // The record itself needs the list; remember it and show the shell now.
    state.pendingDetail = parts[1];
    state.view = "detail";
  } else if (parts[0] === "review") {
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
}

function applyRoute() {
  readRoute();
  if (state.pendingDetail) {
    const rec = (state.emails || []).find((e) => e.email_id === state.pendingDetail);
    if (rec) { state.pendingDetail = null; openDetail(rec, null); return; }
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
  // Also gated on the data: an empty ledger with blank counts was appearing
  // for the whole boot, which is what made the page look half-rendered.
  const onBoard = state.view === "inbox" && !state.category && dataReady();
  el("filters").hidden = !onBoard;
  if (!onBoard) fill(el("subbar"));
}

function render() {
  showDestination();

  if (state.view === "overview") {
    renderOverview();
  } else if (state.view === "inbox") {
    if (!dataReady()) { fill(el("inbox"), skeleton(5)); return; }
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

window.addEventListener("hashchange", () => {
  // An echo of our own pushRoute is already on screen; only navigation we did
  // not initiate (back/forward, a pasted link, a hand-edited hash) needs work.
  const ours = state.routing === location.hash;
  state.routing = null;
  if (!ours) applyRoute();
});

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

/* The masthead lost its status line, so the dot carries the state on its own.
   The text moves into aria-label and the title, which keeps it available to a
   screen reader and on hover without putting it back on screen. */
function station(state_, text) {
  const dot = el("sysdot");
  dot.className = `sysdot ${state_}`;
  dot.setAttribute("aria-label", text);
  dot.setAttribute("title", text);
}

async function boot() {
  // 1. Resolve the destination from the URL before any network call, so the
  //    correct panel and tab are on screen in the first frame rather than
  //    after the round trip. Landing on #/triage used to paint the Overview
  //    panel with the OVERVIEW tab lit while the hash said otherwise.
  readRoute();
  showDestination();
  render();
  fill(el("brand"), icon(BOX, 22, 1.75));
  for (const [id, glyph] of [["tab-overview", GRID], ["tab-inbox", COLUMNS],
    ["tab-review", LIST_CHECK], ["tab-compare", SEND]]) {
    fill(el(id).querySelector(".tab-i"), icon(glyph, 14, 1.5));
  }
  // Same shape as a row action, arrow reversed: it goes back, so it nudges left.
  fill(el("detail-back"),
    h("span", { class: "arw", "aria-hidden": "true" }, icon(ARROW_LEFT, 14, 2)), "Back");

  // 2. The list drives every view; stats only feeds two Overview panels. Both
  //    start now, but the page never waits on the one it does not need yet.
  const statsPromise = api("/api/stats").catch(() => null);

  try {
    state.emails = await api("/api/emails");
  } catch (err) {
    station("bad", "Feed unavailable");
    fill(el(state.view === "detail" ? "overview" : state.view), notice(err.message, boot));
    return;
  }

  mountEmails();

  // 3. Stats land whenever they land; only the two panels that need them are
  //    repainted, and only while that view is still the one on screen.
  state.stats = await statsPromise;
  if (state.stats) paintStatsPanels();
}

boot();
