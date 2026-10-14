#!/usr/bin/env bash
set -euo pipefail
if [[ ${SSH_ORIGINAL_COMMAND:-} =~ ^deploy\ ([a-f0-9]{40})$ ]]; then
  exec sudo /usr/local/sbin/quiz-deploy "${BASH_REMATCH[1]}"
fi
echo 'Only deploy <40-character commit SHA> is allowed' >&2
exit 1
