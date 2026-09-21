# Two-Minute Demo Flow

## Goal

In two minutes, show that the prototype can:

1. triage a 520-email inbox;
2. find an actual SI-versus-BL discrepancy;
3. send an incomplete document set to a human instead of guessing; and
4. catch a country-compliance problem even when both documents match.

The spoken words for every step are in [script.md](script.md).

## Before the presentation (not part of the two minutes)

1. Start the app from the project root:

   ```powershell
   $env:PYTHONPATH="src"
   python -m uvicorn web.app:app --port 8000
   ```

2. Open `http://127.0.0.1:8000` and press `Ctrl+F5` once.
3. Set browser zoom to about 80–90% so the result panel fits on screen.
4. Go to **Try an email** and prepare the form using the exact content below.
5. Upload both PDF documents together and wait until the page shows:

   ```text
   EVERGREEN · MY → ID
   ```

6. Do **not** click **Process email** yet.
7. Return to **Overview**. This is the screen where the timed demo starts.
8. Keep this file and [script.md](script.md) open on another screen or printed.

### Copy-paste content for “Try an email”

**From**

```text
docs@vitalsolutions.sg
```

**Subject**

```text
Indonesia import - validate SI and draft BL
```

**Body**

```text
Hi Documentation Team,

Please compare the attached Shipping Instruction and draft Bill of Lading,
and validate the destination documentation requirements.

Best regards,
Operations Team
```

**PDF documents to upload together**

- [01-block-si-load-port.pdf](../output/pdf/01-block-si-load-port.pdf) — uses the label `Load Port`
- [01-block-bl-port-of-loading.pdf](../output/pdf/01-block-bl-port-of-loading.pdf) — uses the label `Port of Loading`

These two labels have the same meaning. Both documents contain the same value,
`PORT KLANG, MALAYSIA (MYPKG)`, and the system maps both labels to the canonical
field `port_of_loading`. This should produce `SAME`, not a false mismatch.

If the PDFs ever need to be regenerated, run:

```powershell
python scripts/generate_demo_pdfs.py
```

Expected auto-detected details:

- Carrier: `EVERGREEN`
- Origin: `MY`
- Destination: `ID`
- Shipper: `VITAL SOLUTIONS SDN BHD; KUALA LUMPUR, MALAYSIA`
- Consignee: `GLOBAL PAPER TRADING LLC; DUBAI, UNITED ARAB EMIRATES`

## Live flow (exactly two minutes)

### 0:00–0:12 — Establish the scale

**Screen:** Overview

1. Start the timer.
2. Point to **520 emails**, then briefly point to the result breakdown.
3. Do not explain every chart.

**Say:** Script section 1.

### 0:12–0:30 — Show one real discrepancy

**Screen:** Inbox

1. Click **Inbox**.
2. Type this into search:

   ```text
   email_121
   ```

3. Open the result.
4. Point to the `MISMATCH` status and the `gross_weight_kg` row:

   ```text
   SI: 20,842 kg
   BL: 21,342 kg
   ```

5. Do not scroll through every field.

**Say:** Script section 2.

### 0:30–0:45 — Show safe human escalation

**Screen:** Inbox

1. Replace the search with:

   ```text
   email_509
   ```

2. Open the result.
3. Point to `NEEDS_REVIEW`, the single SI attachment, and reason code
   `missing_attachment`.
4. Briefly point out that the sender says the draft BL is still missing.

**Say:** Script section 3.

### 0:45–1:12 — Show PDF and label understanding

**Screen:** Try an email

1. Click **Try an email**. The prepared form and PDF attachments should still be there.
2. Point out that both attachment rows are detected as PDF shipping documents.
3. Preview the SI and point to `Load Port: PORT KLANG, MALAYSIA (MYPKG)`.
4. Close it, preview the BL, and point to `Port of Loading: PORT KLANG, MALAYSIA (MYPKG)`.
5. Close the preview and point to `EVERGREEN` and `MY → ID`.
6. Click **Process email**.
7. While it processes, explain that the two labels map to the same canonical field.

**Say:** Script section 4.

### 1:12–1:43 — Reveal the main result

**Screen:** Result panel

1. Point first to document status `OK`.
2. Then point to country compliance `BLOCK`.
3. Point to the two findings: local Indonesian consignee and labelled NPWP/Tax ID.
4. If visible, briefly point to **Published requirement**; do not open it during the timed demo.

**Say:** Script section 5.

### 1:43–1:55 — State the measured results

**Screen:** Keep the result panel visible.

1. State the final held-out score: `0.9734`.
2. State that the system caught `45 of 46` real defects.
3. State that defect precision was `1.00`, meaning zero false-positive defects.
4. Mention that `18` uncertain cases were escalated for human review.

**Say:** Script section 6.

### 1:55–2:00 — Close

Keep the `OK` and `BLOCK` results visible.

**Say:** Script section 7, then stop.

## Expected live result

```text
Email category:       BL_COMPARISON
Human-review example: email_509 → NEEDS_REVIEW (missing_attachment)
Document comparison: OK
Port of loading:      SAME (Load Port = Port of Loading)
Country compliance:  BLOCK
Blocked checks:       Local Indonesian consignee
                      Consignee Tax ID / NPWP
Final held-out score: 0.9734
Defects caught:       45 of 46
Defect precision:     1.00
Human review:         18 cases
```

The `OK + BLOCK` combination is intentional: all seven compared fields agree between the SI and BL, but the destination-country requirements are not satisfied.

## Quick recovery if something goes wrong

- **Inbox is slow:** say, “This is the precomputed 520-email run,” and go straight to **Try an email**.
- **Search finds nothing:** clear the search, select the **Mismatch** filter, and open any red item.
- **Human-review case is slow:** go directly to `#/inbox/email_509`; it is already
  part of the precomputed run.
- **Live processing takes more than five seconds:** continue section 4 while waiting; do not click the button twice.
- **Live processing fails:** return to **Inbox**, search `email_121`, and close with the discrepancy result. Do not troubleshoot on stage.
- **Browser refreshed and cleared the prepared form:** paste the three fields above, upload the two linked files, then process. Skip the Inbox section to recover the time.

## Final rehearsal checklist

- [ ] App opens without errors.
- [ ] Overview shows 520 emails.
- [ ] Searching `email_121` shows a gross-weight mismatch.
- [ ] Searching `email_509` shows `NEEDS_REVIEW` with `missing_attachment`.
- [ ] Both PDF demo documents are attached before the timer starts.
- [ ] SI preview shows `Load Port`; BL preview shows `Port of Loading`.
- [ ] Auto-detection shows `EVERGREEN · MY → ID`.
- [ ] Processing produces document `OK` and compliance `BLOCK`.
- [ ] The closing metrics are memorised: `0.9734`, `45/46`, precision `1.00`,
      and `18` human-review cases.
- [ ] The complete run stays under two minutes.
