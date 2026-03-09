# ─── CompportIQ Production Environment (GCP) ─────────────────
project     = "compportiq"
environment = "prod"
gcp_project = "compportiq"
gcp_region  = "asia-south1"
gcp_zone    = "asia-south1-a"
# domain_name = "compportiq.ai"  # Uncomment when domain is ready
domain_name = ""

# ─── Cloud SQL ────────────────────────────────────────────────
cloudsql_tier      = "db-custom-2-8192"
cloudsql_disk_size = 50
cloudsql_db_name   = "compportiq"

# ─── Memorystore ─────────────────────────────────────────────
redis_memory_size_gb = 1

# ─── Cloud Run ───────────────────────────────────────────────
api_min_instances = 1
api_max_instances = 20
web_min_instances = 1
web_max_instances = 10

# ─── Labels ──────────────────────────────────────────────────
labels = {
  product = "compportiq"
  team    = "platform"
}

