variable "name_prefix" { type = string }
variable "gcp_region" { type = string }
variable "gcp_zone" { type = string }
variable "tier" { type = string }
variable "disk_size" { type = number }
variable "db_name" { type = string }
variable "vpc_network_id" { type = string }

variable "private_ip_address" {
  description = "Private services access address name (for dependency ordering)"
  type        = string
}

variable "labels" {
  type    = map(string)
  default = {}
}

