variable "name_prefix" { type = string }
variable "rds_endpoint" { type = string }
variable "rds_port" { type = number }
variable "rds_db_name" { type = string }
variable "rds_username" { type = string }
variable "rds_password" {
  type      = string
  sensitive = true
}
variable "redis_endpoint" { type = string }
variable "redis_port" { type = number }

