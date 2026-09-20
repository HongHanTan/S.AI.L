"""Firestore as the system of record for review decisions.

Cloud Run containers are ephemeral; without this a reviewer's decision would
vanish on the next cold start. Local JSON remains the mirror the batch pipeline
reads, so nothing requires network access to run.
"""
import json
import os

from sdoc.compare.alias import AliasStore

COLLECTION = "alias_decisions"


class FirestoreAliasStore(AliasStore):
    def __init__(self, project: str | None = None, root: str | None = None,
                 client=None):
        # root stays None by default so AliasStore can honour SDOC_ALIAS_DIR;
        # passing a literal default here would override it on hosts whose
        # filesystem is read-only.
        super().__init__(root=root)
        self.project = project or os.environ.get("GOOGLE_CLOUD_PROJECT")
        self._client = client
        self._tried = client is not None

    def _firestore(self):
        if not self._tried:
            self._tried = True
            try:
                from google.cloud import firestore
                self._client = firestore.Client(project=self.project)
            except Exception:
                self._client = None
        return self._client

    def record_pending(self, entry: dict) -> None:
        super().record_pending(entry)
        client = self._firestore()
        if client is None:
            return
        try:
            client.collection(COLLECTION).add(entry)
        except Exception:
            pass  # local mirror already holds it

    def restore_pending(self) -> int:
        """Re-materialise Firestore decisions into the local pending queue."""
        client = self._firestore()
        if client is None:
            return 0
        try:
            docs = list(client.collection(COLLECTION).stream())
        except Exception:
            return 0
        count = 0
        with self.pending_path.open("a", encoding="utf-8") as fh:
            for doc in docs:
                fh.write(json.dumps(doc.to_dict()) + "\n")
                count += 1
        return count
