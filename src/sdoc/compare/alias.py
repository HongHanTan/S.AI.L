"""L2 alias table: learns, but only between runs.

A growing table makes runs stateful, which would destroy the attributable
score deltas the scoreboard log depends on. So a scored run pins a read-only
snapshot and writes promotions to a pending queue; `promote()` folds the queue
into a new numbered snapshot.

Human decisions outrank model decisions: a human DIFFERENT removes any existing
link and permanently blocks that pair from being promoted again.
"""
import json
import os
import tempfile
from pathlib import Path

from sdoc.compare.canon import canon_party

PROMOTION_GUARD = 0.85


def _pair_key(a: str, b: str) -> str:
    return "||".join(sorted([a, b]))


class AliasStore:
    def __init__(self, root: str | None = None):
        # Serverless hosts mount a read-only filesystem apart from a temp dir,
        # so the mirror location has to be overridable. Firestore remains the
        # system of record; this is only the local cache of pending decisions.
        self.root = Path(root or os.environ.get("SDOC_ALIAS_DIR", ".aliases"))
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError:
            # A read-only deployment must still serve the app. Fall back to a
            # temp directory rather than failing at import time.
            self.root = Path(tempfile.gettempdir()) / "sdoc-aliases"
            self.root.mkdir(parents=True, exist_ok=True)
        self.pending_path = self.root / "pending.jsonl"
        self.blocked_path = self.root / "blocked.json"

    # -- writing -------------------------------------------------------
    def record_pending(self, entry: dict) -> None:
        with self.pending_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")

    def record_human(self, si_value: str, bl_value: str, verdict: str) -> None:
        self.record_pending({
            "si_value": si_value, "bl_value": bl_value,
            "verdict": verdict, "source": "human", "similarity": 1.0,
        })

    # -- reading -------------------------------------------------------
    def _snapshots(self) -> list[Path]:
        return sorted(self.root.glob("snapshot_*.json"))

    def latest(self) -> str | None:
        snaps = self._snapshots()
        return snaps[-1].stem.split("_", 1)[1] if snaps else None

    def load(self, snapshot: str | None) -> dict[str, str]:
        if snapshot is None:
            snapshot = self.latest()
        if snapshot is None:
            return {}
        path = self.root / f"snapshot_{snapshot}.json"
        if not path.exists():
            return {}
        return json.loads(path.read_text(encoding="utf-8"))

    def _blocked(self) -> set[str]:
        if not self.blocked_path.exists():
            return set()
        return set(json.loads(self.blocked_path.read_text(encoding="utf-8")))

    # -- promotion -----------------------------------------------------
    def promote(self) -> str:
        """Fold the pending queue into a new snapshot. Returns its id."""
        table = dict(self.load(None))
        blocked = self._blocked()

        entries = []
        if self.pending_path.exists():
            for line in self.pending_path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    entries.append(json.loads(line))

        # Human DIFFERENT first: it removes links and blocks the pair forever.
        for entry in entries:
            if entry.get("source") == "human" and entry.get("verdict") == "DIFFERENT":
                a = canon_party(entry["si_value"])
                b = canon_party(entry["bl_value"])
                blocked.add(_pair_key(a, b))
                for key in (a, b):
                    table.pop(key, None)

        for entry in entries:
            if entry.get("verdict") != "SAME":
                continue
            a = canon_party(entry["si_value"])
            b = canon_party(entry["bl_value"])
            if not a or not b or _pair_key(a, b) in blocked:
                continue
            if entry.get("source") != "human" and \
                    float(entry.get("similarity", 0.0)) < PROMOTION_GUARD:
                continue
            key = table.get(a) or table.get(b) or a
            table[a] = key
            table[b] = key

        snapshot = f"{len(self._snapshots()) + 1:04d}"
        (self.root / f"snapshot_{snapshot}.json").write_text(
            json.dumps(table, indent=2), encoding="utf-8")
        self.blocked_path.write_text(json.dumps(sorted(blocked)), encoding="utf-8")
        self.pending_path.unlink(missing_ok=True)
        return snapshot
