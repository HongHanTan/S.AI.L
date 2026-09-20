"""Fold pending alias decisions into a new snapshot.

    python scripts/aliases.py promote
    python scripts/aliases.py show
"""
import sys

from sdoc.compare.alias import AliasStore

store = AliasStore()
command = sys.argv[1] if len(sys.argv) > 1 else "show"

if command == "promote":
    snapshot = store.promote()
    print(f"created snapshot {snapshot} with {len(store.load(snapshot))} entries")
else:
    latest = store.latest()
    table = store.load(latest)
    print(f"latest snapshot: {latest}; {len(table)} entries")
    for key, value in list(table.items())[:20]:
        print(f"  {key} -> {value}")
