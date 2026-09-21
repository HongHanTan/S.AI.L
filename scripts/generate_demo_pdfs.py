"""Generate the two stable PDF fixtures used by the two-minute demo."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf"

COMMON_FIELDS = [
    ("Shipping Line", "Evergreen Marine"),
    ("Shipper", "VITAL SOLUTIONS SDN BHD; KUALA LUMPUR, MALAYSIA"),
    ("Consignee", "GLOBAL PAPER TRADING LLC; DUBAI, UNITED ARAB EMIRATES"),
    ("Notify Party", "SAME AS CONSIGNEE"),
    ("Port of Discharge", "JAKARTA, INDONESIA (IDJKT)"),
    ("Total Containers", "2 x 40'HC"),
    ("Gross Weight (KG)", "42,000 KG"),
]


def make_document(path: Path, title: str, loading_label: str) -> None:
    page_width, page_height = A4
    pdf = canvas.Canvas(str(path), pagesize=A4)
    pdf.setTitle(title.title())
    pdf.setAuthor("SIBL Verification Prototype")

    navy = colors.HexColor("#172554")
    blue = colors.HexColor("#2563EB")
    pale = colors.HexColor("#EFF6FF")
    ink = colors.HexColor("#172033")
    muted = colors.HexColor("#64748B")
    line = colors.HexColor("#CBD5E1")

    pdf.setFillColor(navy)
    pdf.rect(0, page_height - 112, page_width, 112, fill=1, stroke=0)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 20)
    pdf.drawString(48, page_height - 58, title)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(48, page_height - 80, "DEMO SHIPMENT  |  MALAYSIA TO INDONESIA")

    pdf.setFillColor(pale)
    pdf.roundRect(48, page_height - 158, page_width - 96, 28, 5, fill=1, stroke=0)
    pdf.setFillColor(blue)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(60, page_height - 147, "DOCUMENT REFERENCE")
    pdf.setFillColor(ink)
    pdf.setFont("Helvetica", 9)
    pdf.drawRightString(page_width - 60, page_height - 147, "ID-IMPORT-001")

    fields = COMMON_FIELDS[:4] + [
        (loading_label, "PORT KLANG, MALAYSIA (MYPKG)"),
    ] + COMMON_FIELDS[4:]

    y = page_height - 202
    label_x = 60
    for index, (label, value) in enumerate(fields):
        if index % 2 == 0:
            pdf.setFillColor(colors.HexColor("#F8FAFC"))
            pdf.rect(48, y - 10, page_width - 96, 28, fill=1, stroke=0)
        pdf.setFillColor(ink)
        pdf.setFont("Helvetica", 9)
        # Keep label and value in one PDF text run. This looks like a normal
        # shipping form row and gives the extractor an unambiguous
        # ``Label: value`` line instead of two unrelated positioned fragments.
        pdf.drawString(label_x, y, f"{label}: {value}")
        pdf.setStrokeColor(line)
        pdf.line(48, y - 11, page_width - 48, y - 11)
        y -= 36

    pdf.setFillColor(pale)
    pdf.roundRect(48, 72, page_width - 96, 46, 5, fill=1, stroke=0)
    pdf.setFillColor(navy)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(60, 96, "DEMO NOTE")
    pdf.setFont("Helvetica", 8)
    pdf.drawString(60, 82, "This synthetic document is for demonstrating automated field extraction and verification.")

    pdf.setFillColor(muted)
    pdf.setFont("Helvetica", 8)
    pdf.drawString(48, 42, "SIBL Verification Prototype")
    pdf.drawRightString(page_width - 48, 42, "Page 1 of 1")
    pdf.save()


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    make_document(
        OUTPUT / "01-block-si-load-port.pdf",
        "SHIPPING INSTRUCTION",
        "Load Port",
    )
    make_document(
        OUTPUT / "01-block-bl-port-of-loading.pdf",
        "BILL OF LADING (DRAFT)",
        "Port of Loading",
    )


if __name__ == "__main__":
    main()
