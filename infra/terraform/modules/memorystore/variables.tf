variable "name_prefix" { type = string }
variable "gcp_region" { type = string }
variable "memory_size_gb" { type = number }
variable "vpc_network_id" { type = string }

variable "labels" {
  type    = map(string)
  default = {}
}

