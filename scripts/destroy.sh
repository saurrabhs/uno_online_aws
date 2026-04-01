#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

STACK_NAME="${STACK_NAME:-uno-multiplayer}"
REGION="${AWS_REGION:-us-east-1}"

echo ""
echo "================================================"
echo "  UNO Multiplayer - Destroy"
echo "  Stack: $STACK_NAME  |  Region: $REGION"
echo "================================================"
echo ""
echo "WARNING: This will permanently delete all resources and game data."
echo ""
read -r -p "Type 'yes' to confirm: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
error()   { echo "[ERROR] $*" >&2; exit 1; }

# Verify credentials
AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null) \
  || error "AWS credentials not configured."

SAM_BUCKET="${STACK_NAME}-sam-${AWS_ACCOUNT}-${REGION}"

# Get frontend bucket name before deleting the stack
FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text 2>/dev/null || true)

# Empty S3 buckets (required before CloudFormation can delete them)
if [ -n "$FRONTEND_BUCKET" ] && [ "$FRONTEND_BUCKET" != "None" ]; then
  info "Emptying frontend bucket: $FRONTEND_BUCKET"
  aws s3 rm "s3://$FRONTEND_BUCKET" --recursive --region "$REGION" 2>/dev/null || true
  success "Frontend bucket emptied"
fi

if aws s3 ls "s3://$SAM_BUCKET" >/dev/null 2>&1; then
  info "Emptying SAM artifacts bucket: $SAM_BUCKET"
  aws s3 rm "s3://$SAM_BUCKET" --recursive --region "$REGION" 2>/dev/null || true
  aws s3 rb "s3://$SAM_BUCKET" --region "$REGION" 2>/dev/null || true
  success "SAM bucket removed"
fi

# Delete the CloudFormation stack
info "Deleting CloudFormation stack: $STACK_NAME"
aws cloudformation delete-stack \
  --stack-name "$STACK_NAME" \
  --region "$REGION"

info "Waiting for stack deletion (this may take a few minutes)..."
aws cloudformation wait stack-delete-complete \
  --stack-name "$STACK_NAME" \
  --region "$REGION"

echo ""
echo "================================================"
echo "  All resources deleted."
echo "  No further charges will be incurred."
echo "================================================"
echo ""
