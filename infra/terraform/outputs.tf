# ─── VPC ──────────────────────────────────────────────────────
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

# ─── Cloud SQL ────────────────────────────────────────────────
output "cloud_sql_private_ip" {
  description = "Cloud SQL PostgreSQL private IP"
  value       = module.cloudsql.private_ip
}

output "cloud_sql_connection_name" {
  description = "Cloud SQL connection name (project:region:instance)"
  value       = module.cloudsql.connection_name
}

# ─── Memorystore ─────────────────────────────────────────────
output "memorystore_host" {
  description = "Memorystore Redis host (private IP)"
  value       = module.memorystore.host
}

# ─── Cloud Run ───────────────────────────────────────────────
output "api_service_url" {
  description = "API Cloud Run service URL"
  value       = module.cloudrun.api_service_url
}

output "web_service_url" {
  description = "Web Cloud Run service URL"
  value       = module.cloudrun.web_service_url
}

# ─── Load Balancer ───────────────────────────────────────────
output "load_balancer_ip" {
  description = "Global external IP — create DNS A record: compportiq.ai → this IP"
  value       = module.load_balancer.load_balancer_ip
}

# ─── Artifact Registry ──────────────────────────────────────
output "artifact_registry_url" {
  description = "Docker image repository URL"
  value       = module.artifact_registry.repository_url
}

# ─── Secrets ─────────────────────────────────────────────────
output "secret_ids" {
  description = "Map of Secret Manager secret IDs"
  value       = module.secrets.secret_ids
}

# ─── DNS Instructions ───────────────────────────────────────
# After terraform apply, create these DNS records at your registrar:
#   A record:  compportiq.ai → <load_balancer_ip>
#   The managed SSL certificate will auto-provision once DNS propagates.

