provider "google" {
  project = var.gcp_project
  region  = var.gcp_region
}

provider "google-beta" {
  project = var.gcp_project
  region  = var.gcp_region
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  labels = merge(var.labels, {
    project     = var.project
    environment = var.environment
    managed_by  = "terraform"
  })
}

# ─── Enable Required GCP APIs ────────────────────────────────
resource "google_project_service" "apis" {
  for_each = toset([
    "compute.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "run.googleapis.com",
    "container.googleapis.com",  # GKE
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "servicenetworking.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "certificatemanager.googleapis.com",
  ])

  project                    = var.gcp_project
  service                    = each.value
  disable_dependent_services = false
  disable_on_destroy         = false
}

# ─── VPC + Private Services Access ───────────────────────────
module "vpc" {
  source = "./modules/vpc"

  name_prefix = local.name_prefix
  gcp_region  = var.gcp_region
  labels      = local.labels

  depends_on = [google_project_service.apis]
}

# ─── Service Accounts (shared by Cloud Run, Secrets, AR) ────
resource "google_service_account" "api" {
  account_id   = "${local.name_prefix}-api"
  display_name = "CompportIQ API Service Account"

  depends_on = [google_project_service.apis]
}

resource "google_service_account" "web" {
  account_id   = "${local.name_prefix}-web"
  display_name = "CompportIQ Web Service Account"

  depends_on = [google_project_service.apis]
}

# ─── Artifact Registry ──────────────────────────────────────
module "artifact_registry" {
  source = "./modules/artifact-registry"

  name_prefix         = local.name_prefix
  gcp_region          = var.gcp_region
  labels              = local.labels
  api_service_account = google_service_account.api.email
  web_service_account = google_service_account.web.email

  depends_on = [google_project_service.apis]
}

# ─── Cloud SQL (PostgreSQL 16) ───────────────────────────────
module "cloudsql" {
  source = "./modules/cloudsql"

  name_prefix    = local.name_prefix
  gcp_region     = var.gcp_region
  gcp_zone       = var.gcp_zone
  tier           = var.cloudsql_tier
  disk_size      = var.cloudsql_disk_size
  db_name        = var.cloudsql_db_name
  vpc_network_id = module.vpc.vpc_id
  private_ip_address = module.vpc.private_services_address
  labels         = local.labels

  depends_on = [
    google_project_service.apis,
    module.vpc,
  ]
}

# ─── Memorystore (Redis 7) ──────────────────────────────────
module "memorystore" {
  source = "./modules/memorystore"

  name_prefix    = local.name_prefix
  gcp_region     = var.gcp_region
  memory_size_gb = var.redis_memory_size_gb
  vpc_network_id = module.vpc.vpc_id
  labels         = local.labels

  depends_on = [
    google_project_service.apis,
    module.vpc,
  ]
}

# ─── Secret Manager ─────────────────────────────────────────
module "secrets" {
  source = "./modules/secrets"

  name_prefix         = local.name_prefix
  gcp_project         = var.gcp_project
  cloudsql_private_ip = module.cloudsql.private_ip
  cloudsql_db_name    = var.cloudsql_db_name
  cloudsql_password   = module.cloudsql.master_password
  redis_host          = module.memorystore.host
  redis_port          = module.memorystore.port
  redis_auth_string   = module.memorystore.auth_string
  api_service_account = google_service_account.api.email
  web_service_account = google_service_account.web.email
  labels              = local.labels

  depends_on = [google_project_service.apis]
}

# ─── Cloud Run (API + Web) ──────────────────────────────────
module "cloudrun" {
  source = "./modules/cloudrun"

  name_prefix              = local.name_prefix
  gcp_project              = var.gcp_project
  gcp_region               = var.gcp_region
  domain_name              = var.domain_name
  vpc_connector_id         = module.vpc.vpc_connector_id
  cloudsql_connection      = module.cloudsql.connection_name
  api_min_instances        = var.api_min_instances
  api_max_instances        = var.api_max_instances
  web_min_instances        = var.web_min_instances
  web_max_instances        = var.web_max_instances
  secret_ids               = module.secrets.secret_ids
  api_service_account_email = google_service_account.api.email
  web_service_account_email = google_service_account.web.email
  labels                   = local.labels

  depends_on = [google_project_service.apis]
}

# ─── GKE Cluster (replaces Cloud Run over time) ─────────────
module "gke" {
  source = "./modules/gke"

  name_prefix         = local.name_prefix
  project_id          = var.gcp_project
  region              = var.gcp_region
  existing_vpc_id     = module.vpc.vpc_id  # existing VPC (in compportiq-ai) for peering
  api_machine_type    = var.gke_api_machine_type
  api_min_nodes       = var.gke_api_min_nodes
  api_max_nodes       = var.gke_api_max_nodes
  worker_machine_type = var.gke_worker_machine_type
  worker_min_nodes    = var.gke_worker_min_nodes
  worker_max_nodes    = var.gke_worker_max_nodes
  labels              = local.labels

  depends_on = [
    google_project_service.apis,
    module.vpc,
  ]
}

# ─── Cloud Load Balancing + managed SSL ─────────────────────
# Only create load balancer when a domain is configured.
# Without a domain, use Cloud Run URLs directly.
module "load_balancer" {
  source = "./modules/load-balancer"
  count  = var.domain_name != "" ? 1 : 0

  name_prefix      = local.name_prefix
  gcp_project      = var.gcp_project
  domain_name      = var.domain_name
  wildcard_domain  = var.wildcard_domain
  dns_zone_name    = "compportiq-ai"
  api_service_name = module.cloudrun.api_service_name
  web_service_name = module.cloudrun.web_service_name
  gcp_region       = var.gcp_region
  labels           = local.labels

  depends_on = [google_project_service.apis]
}

