variable "name_prefix" { type = string }
variable "gcp_project" { type = string }

variable "cloudsql_private_ip" {
  description = "Cloud SQL private IP address"
  type        = string
}
variable "cloudsql_db_name" { type = string }
variable "cloudsql_password" {
  type      = string
  sensitive = true
}

variable "redis_host" { type = string }
variable "redis_port" { type = number }
variable "redis_auth_string" {
  type      = string
  sensitive = true
}

variable "api_service_account" {
  description = "API Cloud Run service account email"
  type        = string
}
variable "web_service_account" {
  description = "Web Cloud Run service account email"
  type        = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

