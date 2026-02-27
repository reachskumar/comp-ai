# ─── General ──────────────────────────────────────────────────
variable "project" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "compportiq"
}

variable "environment" {
  description = "Environment name (prod, staging)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Primary domain name"
  type        = string
  default     = "compportiq.ai"
}

# ─── VPC ──────────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

# ─── EKS ──────────────────────────────────────────────────────
variable "eks_cluster_version" {
  description = "Kubernetes version for EKS"
  type        = string
  default     = "1.29"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for EKS managed node group"
  type        = list(string)
  default     = ["t3.medium"]
}

variable "eks_node_desired_size" {
  description = "Desired number of worker nodes"
  type        = number
  default     = 3
}

variable "eks_node_min_size" {
  description = "Minimum number of worker nodes"
  type        = number
  default     = 2
}

variable "eks_node_max_size" {
  description = "Maximum number of worker nodes"
  type        = number
  default     = 6
}

# ─── RDS ──────────────────────────────────────────────────────
variable "rds_instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t3.medium"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 50
}

variable "rds_db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "compportiq"
}

variable "rds_master_username" {
  description = "Master username for RDS"
  type        = string
  default     = "compportiq_admin"
}

# ─── ElastiCache ──────────────────────────────────────────────
variable "redis_node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes"
  type        = number
  default     = 1
}

# ─── Tags ─────────────────────────────────────────────────────
variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}

