variable "name_prefix" { type = string }
variable "gcp_project" { type = string }
variable "gcp_region" { type = string }
variable "vpc_connector_id" { type = string }
variable "cloudsql_connection" {
  description = "Cloud SQL connection name (project:region:instance)"
  type        = string
}
variable "api_min_instances" { type = number }
variable "api_max_instances" { type = number }
variable "web_min_instances" { type = number }
variable "web_max_instances" { type = number }

variable "secret_ids" {
  description = "Map of secret name to Secret Manager secret ID"
  type        = map(string)
}

variable "api_service_account_email" {
  description = "API service account email (created at top level)"
  type        = string
}

variable "web_service_account_email" {
  description = "Web service account email (created at top level)"
  type        = string
}

variable "domain_name" {
  description = "Domain name for CORS and public URLs (e.g., compportiq.ai). Leave empty to use Cloud Run URLs."
  type        = string
  default     = ""
}

variable "labels" {
  type    = map(string)
  default = {}
}

