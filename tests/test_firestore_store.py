from sdoc.firestore_store import FirestoreAliasStore


class FakeDoc:
    def __init__(self, data):
        self._data = data

    def to_dict(self):
        return self._data


class FakeCollection:
    def __init__(self):
        self.written = []
        self.docs = []

    def add(self, data):
        self.written.append(data)
        return None, None

    def stream(self):
        return iter(self.docs)


class FakeFirestore:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        return self.collections.setdefault(name, FakeCollection())


def test_human_decision_is_mirrored_to_firestore(tmp_path):
    fake = FakeFirestore()
    store = FirestoreAliasStore(root=str(tmp_path), client=fake)
    store.record_human("EAST BRIGHT", "EB TRADING", "SAME")

    written = fake.collection("alias_decisions").written
    assert len(written) == 1
    assert written[0]["si_value"] == "EAST BRIGHT"
    assert written[0]["source"] == "human"
    assert store.pending_path.exists()


def test_firestore_failure_still_writes_locally(tmp_path):
    class Broken:
        def collection(self, name):
            raise RuntimeError("no network")

    store = FirestoreAliasStore(root=str(tmp_path), client=Broken())
    store.record_human("A", "B", "SAME")
    assert store.pending_path.exists()


def test_pending_entries_are_restored_from_firestore(tmp_path):
    fake = FakeFirestore()
    fake.collection("alias_decisions").docs = [
        FakeDoc({"si_value": "A CORP", "bl_value": "A CORPORATION",
                 "verdict": "SAME", "source": "human", "similarity": 1.0})]
    store = FirestoreAliasStore(root=str(tmp_path), client=fake)
    store.restore_pending()
    assert "A CORP" in store.pending_path.read_text(encoding="utf-8")


def test_no_client_degrades_to_local_only(tmp_path):
    store = FirestoreAliasStore(root=str(tmp_path), client=None, project=None)
    store.record_human("A", "B", "SAME")
    assert store.pending_path.exists()
