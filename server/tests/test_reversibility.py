"""Assert that the IP-identity removal is trivially reversible.

These tests check that the recovery anchor doc exists and contains the
restoration instructions, so a future engineer can find the path back.

See: docs/RECOVERY-IP-IDENTITY.md
"""

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


def test_recovery_doc_exists():
    doc = REPO_ROOT / "docs" / "RECOVERY-IP-IDENTITY.md"
    assert doc.exists(), (
        f"Anchor doc missing at {doc} — restoration would require archaeology. "
        "Restore the doc before proceeding."
    )


def test_recovery_doc_contains_restoration_keywords():
    """The doc must mention the two key restoration mechanisms."""
    doc = REPO_ROOT / "docs" / "RECOVERY-IP-IDENTITY.md"
    text = doc.read_text(encoding="utf-8")
    for keyword in ("alembic downgrade", "get_client_fingerprint", "git revert"):
        assert keyword in text, (
            f"Recovery doc missing keyword {keyword!r} — restoration steps incomplete."
        )
