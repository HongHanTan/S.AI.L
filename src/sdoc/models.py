"""Core data structures shared across the pipeline."""
from dataclasses import dataclass, field

FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)

CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")
REVIEW_REASONS = ("wrong_doc_type", "missing_attachment", "unreadable", "missing_value")


@dataclass
class DocText:
    """Text extracted from one attachment, plus how it was read."""
    path: str
    lines: list[str] = field(default_factory=list)
    fmt: str = ""
    error: str | None = None

    @property
    def text(self) -> str:
        return "\n".join(self.lines)

    @property
    def header(self) -> str:
        """First three non-empty lines, uppercased — used for doc-type detection."""
        non_empty = [ln.strip() for ln in self.lines if ln.strip()]
        return " ".join(non_empty[:3]).upper()


@dataclass
class FieldVerdict:
    """The outcome of comparing one field across both documents."""
    field_name: str
    si_value: str | None
    bl_value: str | None
    verdict: str          # "SAME" | "DIFFERENT"
    decided_by: str       # "gate1" | "L1" | "L2" | "L3" | "L4" | "resolver"
    similarity: float | None = None
    reason: str = ""


@dataclass
class EmailResult:
    """Everything the pipeline concluded about one email."""
    email_id: str
    category: str
    status: str = "OK"
    review_reason: str | None = None
    defect_fields: list[str] = field(default_factory=list)
    verdicts: list[FieldVerdict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    shipment_context: dict = field(default_factory=dict)
    compliance_status: str = "NOT_CHECKED"
    compliance_findings: list[dict] = field(default_factory=list)

    def to_submission_entry(self) -> dict:
        return {
            "category": self.category,
            "status": self.status,
            "review_reason": self.review_reason,
            "defect_fields": list(self.defect_fields),
            "has_defect": self.status == "MISMATCH",
        }
