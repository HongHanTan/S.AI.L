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
      <h3>Try an email</h3>
      <p class="muted">
        Write an email the way a customer would and attach whatever documents
        it would carry &mdash; or none. This runs the <em>whole</em> pipeline:
        classification, document typing, extraction, comparison and rollup. It
        is the same code path the 520-email batch run uses.
      </p>
      <p class="muted">
        You never say which attachment is the Shipping Instruction and which is
        the draft Bill of Lading. Each document's own header decides, because in
        real inboxes filenames lie.
      </p>
      <p>
        <label>From<br>
          <input type="text" id="cmp-from" class="field"
                 placeholder="docs@vitalsolutions.sg"></label>
      </p>
      <p>
        <label>Subject<br>
          <input type="text" id="cmp-subject" class="field"
                 placeholder="TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI"></label>
      </p>
      <p>
        <label>Body<br>
          <textarea id="cmp-body" class="field" rows="5"
                    placeholder="Hi,&#10;&#10;Attached are the SI and draft BL. Please check the details and confirm.&#10;&#10;Thanks"></textarea></label>
      </p>
      <p>
        <label>Attachments (optional, any order)<br>
          <input type="file" id="cmp-files" multiple></label>
      </p>
      <p>
        <button class="action" id="cmp-run">Process email</button>
        <button class="action" id="cmp-eg1">Load a comparison example</button>
        <button class="action" id="cmp-eg2">Load a spam example</button>
        <span class="muted" id="cmp-msg"></span>
      </p>
      <div id="cmp-out"></div>
    </div>`;

  el("cmp-run").addEventListener("click", runCompare);
  el("cmp-eg1").addEventListener("click", () => {
    el("cmp-from").value = "docs@vitalsolutions.sg";
    el("cmp-subject").value = "TO CONFIRM DOCS _ 5ALT-01226 _ KARACHI_PAKISTAN";
    el("cmp-body").value = [
      "Hi Mitchelle,",
      "",
      "Attached are the SI and draft BL for OC 5ALT-01226.",
      "Please check the details and confirm.",
      "",
      "Best Regards,",
      "Deswita",
    ].join("\n");
    el("cmp-msg").textContent = "Now attach an SI and a BL, then Process email.";
  });
  el("cmp-eg2").addEventListener("click", () => {
    el("cmp-from").value = "offers@quick-cargo-deals.biz";
    el("cmp-subject").value = "Increase your shipping revenue with this ONE weird trick";
    el("cmp-body").value = "Click here now to unlock unlimited freight discounts!";
    el("cmp-msg").textContent = "No attachments needed - just Process email.";
  });
}

async function runCompare() {
  const msg = el("cmp-msg");
  const out = el("cmp-out");
  const subject = el("cmp-subject").value;
  const body = el("cmp-body").value;

  if (!subject.trim() && !body.trim()) {
    msg.textContent = "Write a subject or a body first.";
    return;
  }

  msg.textContent = "Processing…";
  out.innerHTML = "";

  const form = new FormData();
  form.append("subject", subject);
  form.append("body", body);
  form.append("sender", el("cmp-from").value);
  for (const f of el("cmp-files").files) form.append("files", f);

  let d;
  try {
    const response = await fetch("/api/try-email", { method: "POST", body: form });
    d = await response.json();
    if (!response.ok) {
      msg.textContent = "";
      out.innerHTML = `<p class="diff">${esc(d.detail || "Processing failed.")}</p>`;
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
  } else if (d.category && d.category !== "BL_COMPARISON") {
    headline = `<p class="same">Not a document-comparison request, so no
      comparison was run.</p>`;
  } else {
    headline = `<p class="same">No mismatch detected.</p>`;
  }

  const classified = d.category
    ? `<p><b>Classified as</b> <span class="pill ${d.status}">${esc(d.category)}</span>
       ${d.classifier && d.classifier !== "gemini"
         ? `<span class="muted">&nbsp;(${esc(d.classifier)})</span>` : ""}</p>`
    : "";

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
    ${classified}
    <p><b>Outcome</b> <span class="pill ${d.status}">${d.status}</span></p>
    ${roles ? `<p class="muted">Documents read as:</p><ul class="muted">${roles}</ul>` : ""}
    ${headline}
    ${notes}
    ${table}`;
}
