#!/bin/bash
# Deploy the game server to the shared EC2 host via SSM.
set -euo pipefail
export AWS_PROFILE=${AWS_PROFILE:-tsumego} AWS_REGION=${AWS_REGION:-ca-central-1}
INSTANCE=i-0d9750c2d5f2ecbc7
cd "$(dirname "$0")/.."
B64=$(tar -cz -C server go.js server.js package.json package-lock.json | base64 -w0)
SCRIPT="export TARBALL_B64='$B64'
$(cat deploy/remote-install.sh)"
PARAMS=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()]}))' <<<"$SCRIPT")
ID=$(aws ssm send-command --instance-ids $INSTANCE --document-name AWS-RunShellScript \
  --parameters "$PARAMS" --query Command.CommandId --output text)
for _ in $(seq 1 90); do
  S=$(aws ssm get-command-invocation --command-id "$ID" --instance-id $INSTANCE --query Status --output text 2>/dev/null || true)
  case $S in Success|Failed|TimedOut|Cancelled) break;; esac; sleep 2
done
echo "[$S]"
aws ssm get-command-invocation --command-id "$ID" --instance-id $INSTANCE \
  --query '[StandardOutputContent,StandardErrorContent]' --output text
[ "$S" = Success ]
