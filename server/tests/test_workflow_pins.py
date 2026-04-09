"""TDD guard for CRIT-6 — third-party GitHub Actions must be pinned to
40-character commit SHAs, not floating tags.

A compromised tag (see the tj-actions/changed-files attack, March 2025)
could exfiltrate GITHUB_TOKEN, WINGET_PAT, and inject malicious code
into bridge-app installers shipped to DJs. The release.yml workflow has
`contents: write` and publishes binaries directly.

This guardrail runs on every CI run and treats any third-party `uses:`
without a 40-char SHA as a test failure. First-party actions (owned by
GitHub, e.g. actions/checkout, github/codeql-action) are exempt.

See docs/security/audit-2026-04-08.md CRIT-6.
"""

import re
from pathlib import Path

import pytest
import yaml

WORKFLOW_DIR = Path(__file__).resolve().parents[2] / ".github" / "workflows"
SHA_PATTERN = re.compile(r"^[0-9a-f]{40}$")

# First-party actions (owned by GitHub) — exempt from SHA pinning
FIRST_PARTY_PREFIXES = ("actions/", "github/")


def _iter_uses(workflow: dict):
    """Yield every `uses:` string from a parsed workflow."""
    for job in (workflow.get("jobs") or {}).values():
        for step in job.get("steps") or []:
            uses = step.get("uses")
            if uses:
                yield uses


@pytest.mark.parametrize(
    "workflow_path",
    sorted(WORKFLOW_DIR.glob("*.yml")),
    ids=lambda p: p.name,
)
def test_third_party_actions_pinned_to_sha(workflow_path: Path):
    """Every third-party action must use a full 40-char commit SHA, e.g.
    softprops/action-gh-release@de2c0eb89ae2a093876385947365aca7b0e5f844 # v2.1.0
    """
    data = yaml.safe_load(workflow_path.read_text())
    offenders = []
    for uses in _iter_uses(data):
        if uses.startswith("./") or uses.startswith("docker://"):
            continue
        action, _, ref = uses.partition("@")
        if any(action.startswith(p) for p in FIRST_PARTY_PREFIXES):
            continue
        if not SHA_PATTERN.match(ref):
            offenders.append(f"{action}@{ref}")
    assert not offenders, (
        f"{workflow_path.name}: third-party actions must be pinned to 40-char SHA, "
        f"found: {offenders}"
    )
