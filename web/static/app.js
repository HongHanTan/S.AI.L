const state = { emails: [], selected: null };

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(`${path} -> ${response.status}`);
  return response.json();
}

function show(view) {
  document.querySelectorAll(".view").forEach((n) => (n.hidden = n.id !== view));
  document.querySelectorAll("nav button").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  if (view === "report") renderReport();
  if (view === "evidence") renderEvidence();
  if (view === "review") renderReview();
  if (view === "compare") renderCompare();
}

async function renderStats() {
  const s = await api("/api/stats");
  const tiles = [
    ["Emails", s.total],
    ["Comparisons", s.categories.BL_COMPARISON || 0],
    ["Mismatches", s.statuses.MISMATCH || 0],
    ["Needs review", s.statuses.NEEDS_REVIEW || 0],
    ["Model calls (L4)", s.layers.L4 || 0],
  ];
  el("stats").innerHTML = tiles
    .map(([label, value]) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`)
    .join("");
}

async function renderInbox() {
  state.emails = await api("/api/emails");
  const rows = state.emails.map((e) => `
    <tr class="row-click" data-id="${e.email_id}">
      <td><code>${e.email_id}</code></td>
      <td>${esc(e.subject).slice(0, 70)}</td>
      <td>${e.category}</td>
      <td>${e.attachment_count}</td>
      <td><span class="pill ${e.status}">${e.status}</span></td>
      <td>${esc((e.defect_fields || []).join(", ") || e.review_reason || "")}</td>
    </tr>`).join("");

  el("inbox").innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>ID</th><th>Subject</th><th>Category</th><th>Att.</th>
    <th>Status</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>`;

  el("inbox").querySelectorAll(".row-click").forEach((row) =>
    row.addEventListener("click", () => {
      state.selected = row.dataset.id;
      show("report");
    }));
}

function verdictRows(detail) {
  return (detail.verdicts || []).map((v) => {
    const differs = v.verdict === "DIFFERENT";
    return `<tr>
      <td>${v.field_name}</td>
      <td class="${differs ? "diff" : ""}">${esc(v.si_value)}</td>
      <td class="${differs ? "diff" : ""}">${esc(v.bl_value)}</td>
      <td class="${differs ? "diff" : "same"}">${v.verdict}</td>
    </tr>`;
  }).join("");
}

async function renderReport() {
  if (!state.selected) {
    el("report").innerHTML =
      `<p class="muted">Pick an email in the Inbox to see its report.</p>`;
    return;
  }
  const d = await api(`/api/emails/${state.selected}`);
  const headline = d.status === "MISMATCH"
    ? `<p class="diff">Mismatch in: ${esc(d.defect_fields.join(", "))}</p>`
    : d.status === "NEEDS_REVIEW"
      ? `<p class="muted">Sent for review — ${esc(d.review_reason)}</p>`
      : `<p class="same">No mismatch detected.</p>`;

  el("report").innerHTML = `<div class="card">
    <h3><code>${d.email_id}</code> — ${esc(d.subject)}</h3>
    <p class="muted">${d.category} &middot; <span class="pill ${d.status}">${d.status}</span></p>
    ${headline}
    <div class="table-wrap"><table>
      <thead><tr><th>Field</th><th>SI value</th><th>BL value</th><th>Result</th></tr></thead>
      <tbody>${verdictRows(d) || `<tr><td colspan="4" class="muted">No comparison ran.</td></tr>`}</tbody>
    </table></div></div>`;
}

async function renderEvidence() {
  if (!state.selected) {
    el("evidence").innerHTML =
      `<p class="muted">Pick an email in the Inbox to trace its decisions.</p>`;
    return;
  }
  const d = await api(`/api/emails/${state.selected}`);
  const rows = (d.verdicts || []).map((v) => `<tr>
      <td>${v.field_name}</td>
      <td><code>${v.decided_by}</code></td>
      <td>${v.similarity == null ? "&mdash;" : v.similarity.toFixed(3)}</td>
      <td>${esc(v.reason) || "&mdash;"}</td>
    </tr>`).join("");

  el("evidence").innerHTML = `<div class="card">
    <h3>Decision trace &mdash; <code>${d.email_id}</code></h3>
    <p class="muted">Which layer settled each field. L1 canonicalization, L2 alias
    table, L3 similarity, L4 model adjudication, resolver for an uncertain L4.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Field</th><th>Decided by</th><th>Similarity</th><th>Reason</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4" class="muted">No comparison ran.</td></tr>`}</tbody>
    </table></div></div>`;
}

async function renderReview() {
  const queue = await api("/api/review-queue");
  if (!queue.length) {
    el("review").innerHTML = `<p class="muted">Review queue is empty.</p>`;
    return;
  }
  el("review").innerHTML = queue.map((item) => `
    <div class="card">
      <h3><code>${item.email_id}</code> &mdash; ${esc(item.subject)}</h3>
      <p class="muted">Reason: <b>${esc(item.review_reason)}</b></p>
      ${(item.verdicts || []).map((v) => `
        <div>
          <b>${v.field_name}</b><br>
          <span class="muted">SI:</span> ${esc(v.si_value)}<br>
          <span class="muted">BL:</span> ${esc(v.bl_value)}<br>
          <button class="action" data-id="${item.email_id}"
                  data-field="${v.field_name}" data-verdict="SAME">Same entity</button>
          <button class="action" data-id="${item.email_id}"
                  data-field="${v.field_name}" data-verdict="DIFFERENT">Different</button>
        </div><hr>`).join("") ||
        `<p class="muted">No field comparison ran — resolve the document problem first.</p>`}
    </div>`).join("");

  el("review").querySelectorAll("button.action").forEach((button) =>
    button.addEventListener("click", async () => {
      await api(`/api/review/${button.dataset.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: button.dataset.field,
                               verdict: button.dataset.verdict }),
      });
      button.parentElement.innerHTML =
        `<p class="same">Recorded: ${button.dataset.field} &rarr; ${button.dataset.verdict}.
         It enters the alias table at the next promotion.</p>`;
    }));
}

document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => show(b.dataset.view)));

renderStats();
renderInbox();


// ---------------------------------------------------------------------------
// Compare documents — runs the real pipeline on two uploaded files.
// Deterministic only: no model call, so it cannot be rate-limited or time out.
// ---------------------------------------------------------------------------

function renderCompare() {
  if (el("compare").dataset.ready) return;
  el("compare").dataset.ready = "1";
  el("compare").innerHTML = `
    <div class="card">
      <h3>Compare a Shipping Instruction against a draft Bill of Lading</h3>
      <p class="muted">
        Upload both documents &mdash; <code>.txt</code>, <code>.pdf</code>,
        <code>.docx</code> or <code>.xlsx</code>. Order does not matter: the
        system reads each document's own header to decide which is which.
        This runs the same extraction and comparison logic as the inbox, with
        no model call, so the result is immediate and fully deterministic.
      </p>
      <p>
        <label>Document 1 &nbsp;<input type="file" id="cmp-a"></label><br><br>
        <label>Document 2 &nbsp;<input type="file" id="cmp-b"></label>
      </p>
      <p>
        <button class="action" id="cmp-run">Compare</button>
        <span class="muted" id="cmp-msg"></span>
      </p>
      <div id="cmp-out"></div>
    </div>`;

  el("cmp-run").addEventListener("click", runCompare);
}

async function runCompare() {
  const a = el("cmp-a").files[0];
  const b = el("cmp-b").files[0];
  const msg = el("cmp-msg");
  const out = el("cmp-out");

  if (!a || !b) {
    msg.textContent = "Pick two documents first.";
    return;
  }

  msg.textContent = "Comparing\u2026";
  out.innerHTML = "";

  const body = new FormData();
  body.append("files", a);
  body.append("files", b);

  let d;
  try {
    const response = await fetch("/api/compare", { method: "POST", body });
    d = await response.json();
    if (!response.ok) {
      msg.textContent = "";
      out.innerHTML = `<p class="diff">${esc(d.detail || "Comparison failed.")}</p>`;
      return;
    }
  } catch (err) {
    msg.textContent = "";
    out.innerHTML = `<p class="diff">Could not reach the server.</p>`;
    return;
  }

  msg.textContent = "";
  out.innerHTML = renderCompareResult(d);
}

function renderCompareResult(d) {
  const roles = (d.documents || [])
    .map((doc) => {
      const label = { SI: "Shipping Instruction", BL: "Bill of Lading" }[doc.detected_type]
        || "not a shipping document";
      return `<li><code>${esc(doc.filename)}</code> &rarr; ${label}</li>`;
    })
    .join("");

  let headline;
  if (d.status === "MISMATCH") {
    headline = `<p class="diff">Mismatch in: ${esc(d.defect_fields.join(", "))}</p>`;
  } else if (d.status === "NEEDS_REVIEW") {
    headline = `<p class="muted">Sent for review &mdash; ${esc(d.review_reason)}</p>`;
  } else {
    headline = `<p class="same">No mismatch detected.</p>`;
  }

  const notes = (d.notes || [])
    .map((n) => `<p class="muted">${esc(n)}</p>`)
    .join("");

  const rows = (d.verdicts || [])
    .map((v) => {
      const differs = v.verdict === "DIFFERENT";
      const missing = v.verdict === "MISSING";
      const cls = differs ? "diff" : missing ? "muted" : "";
      return `<tr>
        <td>${v.field_name}</td>
        <td class="${cls}">${esc(v.si_value)}</td>
        <td class="${cls}">${esc(v.bl_value)}</td>
        <td class="${differs ? "diff" : "same"}">${v.verdict}</td>
        <td><code>${v.decided_by}</code></td>
      </tr>`;
    })
    .join("");

  const table = rows
    ? `<div class="table-wrap"><table>
         <thead><tr><th>Field</th><th>SI value</th><th>BL value</th>
         <th>Result</th><th>Decided by</th></tr></thead>
         <tbody>${rows}</tbody></table></div>`
    : "";

  return `<hr>
    <p><span class="pill ${d.status}">${d.status}</span></p>
    <ul class="muted">${roles}</ul>
    ${headline}
    ${notes}
    ${table}`;
}
