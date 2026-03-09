# ─── IAM: API service account roles ─────────────────────────
# Service accounts are created at the top level (main.tf) and
# passed in as variables to break circular dependencies.
resource "google_project_iam_member" "api_cloudsql" {
  project = var.gcp_project
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${var.api_service_account_email}"
}

resource "google_project_iam_member" "api_secretmanager" {
  project = var.gcp_project
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${var.api_service_account_email}"
}

resource "google_project_iam_member" "api_logging" {
  project = var.gcp_project
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${var.api_service_account_email}"
}

# ─── IAM: Web service account roles ─────────────────────────
resource "google_project_iam_member" "web_secretmanager" {
  project = var.gcp_project
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${var.web_service_account_email}"
}

resource "google_project_iam_member" "web_logging" {
  project = var.gcp_project
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${var.web_service_account_email}"
}

# ─── API Cloud Run Service ──────────────────────────────────
resource "google_cloud_run_v2_service" "api" {
  name     = "${var.name_prefix}-api"
  location = var.gcp_region

  deletion_protection = false

  template {
    service_account = var.api_service_account_email

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    max_instance_request_concurrency = 80
    timeout                          = "300s"

    vpc_access {
      connector = var.vpc_connector_id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [var.cloudsql_connection]
      }
    }

    containers {
      image = "gcr.io/cloudrun/placeholder"

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
        cpu_idle          = false
        startup_cpu_boost = true
      }

      startup_probe {
        http_get {
          path = "/health"
          port = 4000
        }
        initial_delay_seconds = 10
        period_seconds        = 10
        failure_threshold     = 3
        timeout_seconds       = 5
      }

      liveness_probe {
        http_get {
          path = "/health"
          port = 4000
        }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 5
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      # ─── Env vars from Secret Manager ────────────────────
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["database_url"]
            version = "latest"
          }
        }
      }
      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["redis_url"]
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["jwt_secret"]
            version = "latest"
          }
        }
      }
      env {
        name = "INTEGRATION_ENCRYPTION_KEY"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["encryption_key"]
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["azure_openai_key"]
            version = "latest"
          }
        }
      }
      env {
        name = "AZURE_OPENAI_ENDPOINT"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["azure_openai_endpoint"]
            version = "latest"
          }
        }
      }

      # ─── Static env vars ─────────────────────────────────
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "API_PORT"
        value = "4000"
      }
      env {
        name  = "CORS_ORIGINS"
        value = var.domain_name != "" ? "https://${var.domain_name}" : "*"
      }
      env {
        name  = "JWT_EXPIRATION"
        value = "1d"
      }
      env {
        name  = "LOG_LEVEL"
        value = "info"
      }
      env {
        name  = "COMPPORT_MODE"
        value = "standalone"
      }
      env {
        name  = "AI_PROVIDER"
        value = "azure"
      }
      env {
        name  = "SHUTDOWN_TIMEOUT"
        value = "30000"
      }
      env {
        name  = "AZURE_OPENAI_DEPLOYMENT_NAME"
        value = "gpt-4o"
      }
      env {
        name  = "AZURE_OPENAI_API_VERSION"
        value = "2024-08-01-preview"
      }
    }
  }

  labels = var.labels

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

# ─── Web Cloud Run Service ──────────────────────────────────
resource "google_cloud_run_v2_service" "web" {
  name     = "${var.name_prefix}-web"
  location = var.gcp_region

  deletion_protection = false

  template {
    service_account = var.web_service_account_email

    scaling {
      min_instance_count = var.web_min_instances
      max_instance_count = var.web_max_instances
    }

    max_instance_request_concurrency = 100
    timeout                          = "60s"

    containers {
      image = "gcr.io/cloudrun/placeholder"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }

      startup_probe {
        tcp_socket {
          port = 3000
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 5
        timeout_seconds       = 3
      }

      liveness_probe {
        http_get {
          path = "/"
          port = 3000
        }
        period_seconds    = 30
        failure_threshold = 3
        timeout_seconds   = 5
      }

      env {
        name = "NEXTAUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = var.secret_ids["nextauth_secret"]
            version = "latest"
          }
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = var.domain_name != "" ? "https://${var.domain_name}" : ""
      }
      env {
        name  = "NEXTAUTH_URL"
        value = var.domain_name != "" ? "https://${var.domain_name}" : ""
      }
      env {
        name  = "NEXT_TELEMETRY_DISABLED"
        value = "1"
      }
    }
  }

  labels = var.labels

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

# ─── Allow unauthenticated access (public services behind LB) ─
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = google_cloud_run_v2_service.api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = google_cloud_run_v2_service.web.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

