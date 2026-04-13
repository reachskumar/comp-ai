# ─── General ──────────────────────────────────────────────────
variable "project" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "compportiq"
}

variable "environment" {
  description = "Environment name (prod, staging)"
  type        = string
  default     = "prod"
}

variable "gcp_project" {
  description = "GCP project ID"
  type        = string
}

variable "gcp_region" {
  description = "GCP region for all resources"
  type        = string
  default     = "asia-south1"
}

variable "gcp_zone" {
  description = "GCP primary zone (for zonal resources)"
  type        = string
  default     = "asia-south1-a"
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "compportiq.ai"
}

variable "wildcard_domain" {
  description = "Wildcard domain for tenant subdomains (e.g., *.compportiq.ai)"
  type        = string
  default     = "*.compportiq.ai"
}

# ─── Cloud SQL ────────────────────────────────────────────────
variable "cloudsql_tier" {
  description = "Cloud SQL machine tier"
  type        = string
  default     = "db-custom-2-8192"
}

variable "cloudsql_disk_size" {
  description = "Cloud SQL disk size in GB"
  type        = number
  default     = 50
}

variable "cloudsql_db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "compportiq"
}

# ─── Memorystore ─────────────────────────────────────────────
variable "redis_memory_size_gb" {
  description = "Memorystore Redis memory size in GB"
  type        = number
  default     = 1
}

# ─── Cloud Run ───────────────────────────────────────────────
variable "api_min_instances" {
  description = "Minimum API Cloud Run instances"
  type        = number
  default     = 1
}

variable "api_max_instances" {
  description = "Maximum API Cloud Run instances"
  type        = number
  default     = 20
}

variable "web_min_instances" {
  description = "Minimum Web Cloud Run instances"
  type        = number
  default     = 1
}

variable "web_max_instances" {
  description = "Maximum Web Cloud Run instances"
  type        = number
  default     = 10
}

# ─── GKE ─────────────────────────────────────────────────────
variable "gke_api_machine_type" {
  description = "GKE default node pool machine type"
  type        = string
  default     = "e2-standard-4"
}

variable "gke_api_min_nodes" {
  type    = number
  default = 2
}

variable "gke_api_max_nodes" {
  type    = number
  default = 10
}

variable "gke_worker_machine_type" {
  description = "GKE worker node pool machine type"
  type        = string
  default     = "e2-standard-8"
}

variable "gke_worker_min_nodes" {
  type    = number
  default = 1
}

variable "gke_worker_max_nodes" {
  type    = number
  default = 5
}

# ─── Labels ──────────────────────────────────────────────────
variable "labels" {
  description = "Common labels for all resources"
  type        = map(string)
  default     = {}
}

