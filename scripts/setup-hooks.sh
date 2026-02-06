#!/usr/bin/env bash
set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"

ln -sf ../../scripts/pre-commit "$REPO_ROOT/.git/hooks/pre-commit"

echo "Git hooks installed."
