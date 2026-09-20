def read_txt(raw: bytes) -> list[str]:
    return raw.decode("utf-8", errors="replace").splitlines()
