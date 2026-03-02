# ─── Artifact Registry Docker Repository ────────────────────
resource "google_artifact_registry_repository" "main" {
  location      = var.gcp_region
  repository_id = "${var.name_prefix}-docker"
  format        = "DOCKER"
  description   = "CompportIQ container images"

  cleanup_policies {
    id     = "keep-recent-tags"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s" # 7 days
    }
  }

  labels = var.labels
}

# ─── IAM: Cloud Run service accounts can pull ───────────────
resource "google_artifact_registry_repository_iam_member" "api_reader" {
  location   = google_artifact_registry_repository.main.location
  repository = google_artifact_registry_repository.main.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${var.api_service_account}"
}

resource "google_artifact_registry_repository_iam_member" "web_reader" {
  location   = google_artifact_registry_repository.main.location
  repository = google_artifact_registry_repository.main.name
  role       = "roles/artifactregistry.reader"
  member     = "serviceAccount:${var.web_service_account}"
}

