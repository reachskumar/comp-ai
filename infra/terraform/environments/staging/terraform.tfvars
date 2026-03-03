# ─── CompportIQ Staging Environment (GCP) ─────────────────
project     = "compportiq"
environment = "staging"
gcp_project = "compportiq-ai"
gcp_region  = "asia-south1"
gcp_zone    = "asia-south1-a"
domain_name = "staging.compportiq.ai"

# ─── Cloud SQL (smaller for cost savings) ────────────────────
cloudsql_tier      = "db-f1-micro"
cloudsql_disk_size = 10
cloudsql_db_name   = "compportiq"

# ─── Memorystore ─────────────────────────────────────────────
redis_memory_size_gb = 1

# ─── Cloud Run (minimal scaling for staging) ─────────────────
api_min_instances = 0
api_max_instances = 3
web_min_instances = 0
web_max_instances = 2

# ─── Labels ──────────────────────────────────────────────────
labels = {
  product     = "compportiq"
  team        = "platform"
  environment = "staging"
}

