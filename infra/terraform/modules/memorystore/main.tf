# ─── AUTH string ─────────────────────────────────────────────
resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

# ─── Memorystore Redis Instance ─────────────────────────────
resource "google_redis_instance" "main" {
  name           = "${var.name_prefix}-redis"
  tier           = "STANDARD_HA"
  memory_size_gb = var.memory_size_gb
  region         = var.gcp_region

  redis_version = "REDIS_7_2"

  authorized_network = var.vpc_network_id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  auth_enabled = true

  redis_configs = {
    maxmemory-policy = "allkeys-lru"
  }

  maintenance_policy {
    weekly_maintenance_window {
      day = "SUNDAY"
      start_time {
        hours   = 3
        minutes = 0
        seconds = 0
        nanos   = 0
      }
    }
  }

  labels = var.labels
}

