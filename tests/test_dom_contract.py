import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_app_dom_reference_exists_in_index():
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    referenced = set(re.findall(r"\$\(['\"]([^'\"]+)['\"]\)", app))
    ids = set(re.findall(r'id=["\']([^"\']+)["\']', html))
    missing = sorted(referenced - ids)
    assert not missing, f"index.html is missing app.js element IDs: {missing}"
