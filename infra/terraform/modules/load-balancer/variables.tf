variable "name_prefix" { type = string }
variable "gcp_project" { type = string }
variable "gcp_region" { type = string }
variable "domain_name" { type = string }
variable "api_service_name" {
  description = "API Cloud Run service name"
  type        = string
}
variable "web_service_name" {
  description = "Web Cloud Run service name"
  type        = string
}

variable "wildcard_domain" {
  description = "Wildcard domain for tenant subdomains (e.g., *.compportiq.ai)"
  type        = string
  default     = ""
}

variable "dns_zone_name" {
  description = "Cloud DNS managed zone name for DNS authorization CNAME records"
  type        = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

