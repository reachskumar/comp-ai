variable "name_prefix" { type = string }
variable "gcp_region" { type = string }
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

