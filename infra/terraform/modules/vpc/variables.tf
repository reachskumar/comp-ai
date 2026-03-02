variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "gcp_region" {
  description = "GCP region"
  type        = string
}

variable "labels" {
  description = "Common labels"
  type        = map(string)
  default     = {}
}

