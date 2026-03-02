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

variable "labels" {
  type    = map(string)
  default = {}
}

