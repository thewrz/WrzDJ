#!/bin/bash
# Run this script after making the repository public to enable branch protection
# Usage: ./.github/setup-branch-protection.sh

REPO="thewrz/WrzDJ"

echo "Setting up branch protection for $REPO..."

# Create branch protection rule for main
gh api repos/$REPO/branches/main/protection \
  --method PUT \
  --field required_status_checks=null \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1,"require_code_owner_reviews":true,"dismiss_stale_reviews":true}' \
  --field restrictions=null \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field block_creations=false \
  --field required_conversation_resolution=true

if [ $? -eq 0 ]; then
  echo "Branch protection enabled successfully!"
  echo ""
  echo "Rules applied:"
  echo "  - Require PR with at least 1 approval before merging"
  echo "  - Require review from CODEOWNERS (@thewrz)"
  echo "  - Dismiss stale reviews when new commits are pushed"
  echo "  - Require conversation resolution before merging"
  echo "  - Disallow force pushes"
  echo "  - Disallow branch deletion"
else
  echo "Failed to set branch protection. Make sure the repo is public."
fi
