"""Read .xlsx label/value sheets into 'Label: value' lines.

openpyxl is the primary path; a stdlib zipfile+XML fallback keeps the 22 xlsx
attachments working even if the dependency is unavailable. The bundle's sheets
use inline strings, so there is no sharedStrings.xml to consult.
"""
import html
import io
import re
import zipfile

_ROW = re.compile(rb"<row[^>]*>(.*?)</row>", re.S)
_CELL = re.compile(rb"<c\b[^>]*>(.*?)</c>", re.S)
_TEXT = re.compile(rb"<t[^>]*>(.*?)</t>", re.S)


def _rows_to_lines(rows: list[list[str]]) -> list[str]:
    lines = []
    for cells in rows:
        cells = [html.unescape(c).strip() for c in cells if c is not None]
        cells = [c for c in cells if c]
        if len(cells) >= 2:
            lines.append(f"{cells[0]}: {cells[1]}")
        elif len(cells) == 1:
            lines.append(cells[0])
    return lines


def _read_with_stdlib(raw: bytes) -> list[list[str]]:
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        names = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
        for name in sorted(names):
            blob = z.read(name)
            for row_match in _ROW.finditer(blob):
                cells = []
                for cell_match in _CELL.finditer(row_match.group(1)):
                    texts = _TEXT.findall(cell_match.group(1))
                    cells.append(
                        " ".join(t.decode("utf-8", "replace") for t in texts)
                    )
                rows.append(cells)
    return rows


def _read_with_openpyxl(raw: bytes) -> list[list[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    rows = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            rows.append(["" if v is None else str(v) for v in row])
    wb.close()
    return rows


def read_xlsx(raw: bytes) -> list[str]:
    try:
        rows = _read_with_openpyxl(raw)
    except Exception:
        rows = _read_with_stdlib(raw)
    if not any(any(c.strip() for c in r) for r in rows):
        rows = _read_with_stdlib(raw)
    return _rows_to_lines(rows)
