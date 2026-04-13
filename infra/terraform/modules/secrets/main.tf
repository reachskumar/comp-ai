# ─── Auto-generated secrets ──────────────────────────────────
resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

resource "random_password" "nextauth_secret" {
  length  = 64
  special = true
}

resource "random_password" "encryption_key" {
  length  = 64
  special = false
}

# ─── Database URL ────────────────────────────────────────────
resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name_prefix}-database-url"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://compportiq_admin:${var.cloudsql_password}@${var.cloudsql_private_ip}:5432/${var.cloudsql_db_name}?sslmode=require"
}

# ─── Redis URL ──────────────────────────────────────────────
resource "google_secret_manager_secret" "redis_url" {
  secret_id = "${var.name_prefix}-redis-url"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.id
  secret_data = "redis://:${var.redis_auth_string}@${var.redis_host}:${var.redis_port}"
}

# ─── JWT Secret ─────────────────────────────────────────────
resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "${var.name_prefix}-jwt-secret"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = random_password.jwt_secret.result
}

# ─── NextAuth Secret ────────────────────────────────────────
resource "google_secret_manager_secret" "nextauth_secret" {
  secret_id = "${var.name_prefix}-nextauth-secret"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "nextauth_secret" {
  secret      = google_secret_manager_secret.nextauth_secret.id
  secret_data = random_password.nextauth_secret.result
}

# ─── Encryption Key (AES-256-GCM for PII) ──────────────────
resource "google_secret_manager_secret" "encryption_key" {
  secret_id = "${var.name_prefix}-encryption-key"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "encryption_key" {
  secret      = google_secret_manager_secret.encryption_key.id
  secret_data = random_password.encryption_key.result
}

# ─── BENEFITS_ENCRYPTION_KEY (AES-256-GCM for SSN/PHI) ─────────
# IMPORTANT: this secret was created out-of-band via gcloud during the
# BLOCKER 2 fix. The data is owned by GCP, not Terraform — never let
# TF write secret_data here or it will rotate the key and make
# previously-encrypted SSN data unrecoverable.
resource "google_secret_manager_secret" "benefits_encryption_key" {
  secret_id = "${var.name_prefix}-benefits-encryption-key"

  replication {
    auto {}
  }

  labels = var.labels

  lifecycle {
    prevent_destroy = true
  }
}

# Import these secrets into TF state manually before first apply:
#   terraform import 'module.secrets.google_secret_manager_secret.benefits_encryption_key' \
#     'projects/compportiq/secrets/compportiq-prod-benefits-encryption-key'
#   terraform import 'module.secrets.google_secret_manager_secret.platform_config_encryption_key' \
#     'projects/compportiq/secrets/compportiq-prod-platform-config-encryption-key'

# ─── PLATFORM_CONFIG_ENCRYPTION_KEY (AES-256-GCM for platform_config) ──
resource "google_secret_manager_secret" "platform_config_encryption_key" {
  secret_id = "${var.name_prefix}-platform-config-encryption-key"

  replication {
    auto {}
  }

  labels = var.labels

  lifecycle {
    prevent_destroy = true
  }
}

# ─── Azure OpenAI (placeholder — replace with real values after deploy) ──
resource "google_secret_manager_secret" "azure_openai_key" {
  secret_id = "${var.name_prefix}-azure-openai-key"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "azure_openai_key" {
  secret      = google_secret_manager_secret.azure_openai_key.id
  secret_data = "REPLACE_WITH_REAL_AZURE_OPENAI_KEY"
}

resource "google_secret_manager_secret" "azure_openai_endpoint" {
  secret_id = "${var.name_prefix}-azure-openai-endpoint"

  replication {
    auto {}
  }

  labels = var.labels
}

resource "google_secret_manager_secret_version" "azure_openai_endpoint" {
  secret      = google_secret_manager_secret.azure_openai_endpoint.id
  secret_data = "https://REPLACE_WITH_REAL_ENDPOINT.openai.azure.com"
}



# ─── IAM: API service account can access all secrets ─────────
locals {
  all_secrets = [
    google_secret_manager_secret.database_url.secret_id,
    google_secret_manager_secret.redis_url.secret_id,
    google_secret_manager_secret.jwt_secret.secret_id,
    google_secret_manager_secret.encryption_key.secret_id,
    google_secret_manager_secret.benefits_encryption_key.secret_id,
    google_secret_manager_secret.platform_config_encryption_key.secret_id,
    google_secret_manager_secret.azure_openai_key.secret_id,
    google_secret_manager_secret.azure_openai_endpoint.secret_id,
  ]
  web_secrets = [
    google_secret_manager_secret.nextauth_secret.secret_id,
  ]
}

resource "google_secret_manager_secret_iam_member" "api_accessor" {
  for_each  = toset(local.all_secrets)
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.api_service_account}"
}

resource "google_secret_manager_secret_iam_member" "web_accessor" {
  for_each  = toset(local.web_secrets)
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.web_service_account}"
}