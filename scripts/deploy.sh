#!/usr/bin/env bash
# Deploy the demo to Cloud Run.
#   PROJECT_ID=my-project ./scripts/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID}"
REGION="${REGION:-asia-southeast1}"
SERVICE="${SERVICE:-sdoc-verify}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/sdoc/${SERVICE}"

gcloud config set project "${PROJECT_ID}"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
    firestore.googleapis.com

gcloud artifacts repositories describe sdoc --location="${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create sdoc \
    --repository-format=docker --location="${REGION}"

python scripts/run.py
gcloud builds submit --tag "${IMAGE}"

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"

gcloud run services describe "${SERVICE}" --region "${REGION}" \
  --format='value(status.url)'
