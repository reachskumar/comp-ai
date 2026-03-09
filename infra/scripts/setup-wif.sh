#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# Setup Workload Identity Federation for GitHub Actions → GCP
#
# This script creates the necessary GCP resources for keyless
# authentication from GitHub Actions to Google Cloud.
#
# Usage:
#   export GCP_PROJECT=compportiq
#   export GITHUB_REPO=reachskumar/comp-ai
#   bash infra/scripts/setup-wif.sh
#
# Idempotent: safe to re-run.
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────
PROJECT_ID="${GCP_PROJECT:-compportiq}"
GITHUB_REPO="${GITHUB_REPO:-reachskumar/comp-ai}"
REGION="${GCP_REGION:-asia-south1}"
SA_NAME="github-actions-deployer"
SA_DISPLAY="GitHub Actions Deployer"
POOL_NAME="github-actions-pool"
PROVIDER_NAME="github-actions-provider"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Workload Identity Federation Setup                 ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Project:  ${PROJECT_ID}"
echo "║  Repo:     ${GITHUB_REPO}"
echo "║  Region:   ${REGION}"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Enable required APIs ──────────────────────────────────────
echo "→ Enabling APIs..."
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# ── 2. Create service account ────────────────────────────────────
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
echo "→ Creating service account: ${SA_EMAIL}"
gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" 2>/dev/null \
  || gcloud iam service-accounts create "${SA_NAME}" \
    --display-name="${SA_DISPLAY}" \
    --project="${PROJECT_ID}"

# ── 3. Grant roles to service account ────────────────────────────
echo "→ Granting IAM roles..."
ROLES=(
  "roles/run.admin"
  "roles/artifactregistry.writer"
  "roles/secretmanager.secretAccessor"
  "roles/iam.serviceAccountUser"
  "roles/cloudsql.client"
  "roles/storage.objectViewer"
)

for ROLE in "${ROLES[@]}"; do
  echo "   ${ROLE}"
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --condition=None \
    --quiet 2>/dev/null || true
done

# ── 4. Create Workload Identity Pool ─────────────────────────────
echo "→ Creating Workload Identity Pool..."
gcloud iam workload-identity-pools describe "${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" 2>/dev/null \
  || gcloud iam workload-identity-pools create "${POOL_NAME}" \
    --location="global" \
    --display-name="GitHub Actions" \
    --project="${PROJECT_ID}"

# ── 5. Create Workload Identity Provider ──────────────────────────
echo "→ Creating Workload Identity Provider..."
gcloud iam workload-identity-pools providers describe "${PROVIDER_NAME}" \
  --workload-identity-pool="${POOL_NAME}" \
  --location="global" --project="${PROJECT_ID}" 2>/dev/null \
  || gcloud iam workload-identity-pools providers create-oidc "${PROVIDER_NAME}" \
    --workload-identity-pool="${POOL_NAME}" \
    --location="global" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
    --project="${PROJECT_ID}"

# ── 6. Allow GitHub Actions to impersonate the SA ─────────────────
echo "→ Binding WIF to service account..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
MEMBER="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/attribute.repository/${GITHUB_REPO}"

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="${MEMBER}" \
  --condition=None \
  --quiet 2>/dev/null || true

# ── 7. Output values for GitHub Secrets ───────────────────────────
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✅ Setup complete! Set these GitHub Secrets:       ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "  GCP_PROJECT_ID      = ${PROJECT_ID}"
echo "  GCP_WIF_PROVIDER    = ${WIF_PROVIDER}"
echo "  GCP_SERVICE_ACCOUNT = ${SA_EMAIL}"
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"

