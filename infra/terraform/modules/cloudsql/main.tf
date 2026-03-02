# ─── KMS Key for CMEK Encryption ─────────────────────────────
resource "google_kms_key_ring" "cloudsql" {
  name     = "${var.name_prefix}-cloudsql"
  location = var.gcp_region
}

resource "google_kms_crypto_key" "cloudsql" {
  name     = "${var.name_prefix}-cloudsql-key"
  key_ring = google_kms_key_ring.cloudsql.id

  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# ─── Random password for master user ─────────────────────────
resource "random_password" "master" {
  length  = 32
  special = false
}

# ─── Cloud SQL PostgreSQL Instance ───────────────────────────
resource "google_sql_database_instance" "main" {
  name             = "${var.name_prefix}-postgres"
  database_version = "POSTGRES_16"
  region           = var.gcp_region

  deletion_protection = true

  encryption_key_name = google_kms_crypto_key.cloudsql.id

  settings {
    tier              = var.tier
    availability_type = "REGIONAL"
    disk_size         = var.disk_size
    disk_type         = "PD_SSD"
    disk_autoresize   = true

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = var.vpc_network_id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 7 # Sunday
      hour         = 4
      update_track = "stable"
    }

    database_flags {
      name  = "log_connections"
      value = "on"
    }
    database_flags {
      name  = "log_disconnections"
      value = "on"
    }
    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 4096
      record_application_tags = true
      record_client_address   = true
    }

    user_labels = var.labels
  }
}

# ─── Database ────────────────────────────────────────────────
resource "google_sql_database" "main" {
  name     = var.db_name
  instance = google_sql_database_instance.main.name
}

# ─── Master User ────────────────────────────────────────────
resource "google_sql_user" "master" {
  name     = "compportiq_admin"
  instance = google_sql_database_instance.main.name
  password = random_password.master.result
}

