#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="uno-multiplayer"
REGION="us-east-1"
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
SAM_BUCKET="${STACK_NAME}-sam-${ACCOUNT}-${REGION}"
FRONTEND_BUCKET="uno-game-frontend-${ACCOUNT}-prod"

echo "Account: $ACCOUNT"
echo "Cleaning up all UNO resources..."

# 1. Empty and delete frontend S3 bucket
echo ">>> Emptying frontend bucket..."
aws s3 rm "s3://$FRONTEND_BUCKET" --recursive --region "$REGION" 2>/dev/null || echo "  (bucket empty or not found)"
aws s3 rb "s3://$FRONTEND_BUCKET" --region "$REGION" 2>/dev/null || echo "  (bucket not found)"

# 2. Empty and delete SAM artifacts bucket
echo ">>> Emptying SAM bucket..."
aws s3 rm "s3://$SAM_BUCKET" --recursive --region "$REGION" 2>/dev/null || echo "  (bucket empty or not found)"
aws s3 rb "s3://$SAM_BUCKET" --region "$REGION" 2>/dev/null || echo "  (bucket not found)"

# 3. Check stack status
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query "Stacks[0].StackStatus" --output text 2>/dev/null || echo "DOES_NOT_EXIST")
echo ">>> Stack status: $STACK_STATUS"

# 4. If stack is in ROLLBACK_COMPLETE, delete it
if [ "$STACK_STATUS" != "DOES_NOT_EXIST" ]; then
  echo ">>> Deleting CloudFormation stack..."
  aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
  echo ">>> Waiting for deletion (up to 10 min)..."
  aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
  echo ">>> Stack deleted."
else
  echo ">>> Stack does not exist, nothing to delete."
fi

# 5. Delete SAM build cache
rm -rf "../infrastructure/.aws-sam" 2>/dev/null || true
echo ">>> SAM build cache cleared."

echo ""
echo "All clean! Now run: bash scripts/deploy.sh"