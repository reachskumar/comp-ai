variable "name_prefix" {
  type = string
}

variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "existing_vpc_id" {
  type        = string
  description = "Existing VPC ID (for peering — gives GKE pods access to Cloud SQL + Redis)"
}

variable "api_machine_type" {
  type    = string
  default = "e2-standard-4" # 4 vCPU, 16GB — API + Web
}

variable "api_min_nodes" {
  type    = number
  default = 2
}

variable "api_max_nodes" {
  type    = number
  default = 10
}

variable "worker_machine_type" {
  type    = string
  default = "e2-standard-8" # 8 vCPU, 32GB — sync workers
}

variable "worker_min_nodes" {
  type    = number
  default = 1
}

variable "worker_max_nodes" {
  type    = number
  default = 5
}

variable "labels" {
  type    = map(string)
  default = {}
}
