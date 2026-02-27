# ─── CompportIQ Production Environment ────────────────────────
project     = "compportiq"
environment = "prod"
aws_region  = "us-east-1"
domain_name = "compportiq.ai"

# ─── VPC ──────────────────────────────────────────────────────
vpc_cidr           = "10.0.0.0/16"
availability_zones = ["us-east-1a", "us-east-1b", "us-east-1c"]

# ─── EKS ──────────────────────────────────────────────────────
eks_cluster_version     = "1.29"
eks_node_instance_types = ["t3.medium"]
eks_node_desired_size   = 3
eks_node_min_size       = 2
eks_node_max_size       = 6

# ─── RDS ──────────────────────────────────────────────────────
rds_instance_class    = "db.t3.medium"
rds_allocated_storage = 50
rds_db_name           = "compportiq"
rds_master_username   = "compportiq_admin"

# ─── ElastiCache ──────────────────────────────────────────────
redis_node_type       = "cache.t3.micro"
redis_num_cache_nodes = 1

# ─── Tags ─────────────────────────────────────────────────────
tags = {
  Product = "CompportIQ"
  Team    = "Platform"
}

