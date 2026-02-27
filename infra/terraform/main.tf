provider "aws" {
  region = var.aws_region

  default_tags {
    tags = merge(var.tags, {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

locals {
  name_prefix = "${var.project}-${var.environment}"
}

# ─── VPC ──────────────────────────────────────────────────────
module "vpc" {
  source = "./modules/vpc"

  name_prefix        = local.name_prefix
  vpc_cidr           = var.vpc_cidr
  availability_zones = var.availability_zones
}

# ─── ECR ──────────────────────────────────────────────────────
module "ecr" {
  source = "./modules/ecr"

  name_prefix = local.name_prefix
}

# ─── EKS ──────────────────────────────────────────────────────
module "eks" {
  source = "./modules/eks"

  name_prefix         = local.name_prefix
  cluster_version     = var.eks_cluster_version
  vpc_id              = module.vpc.vpc_id
  private_subnet_ids  = module.vpc.private_subnet_ids
  node_instance_types = var.eks_node_instance_types
  node_desired_size   = var.eks_node_desired_size
  node_min_size       = var.eks_node_min_size
  node_max_size       = var.eks_node_max_size
}

# ─── RDS (PostgreSQL) ────────────────────────────────────────
module "rds" {
  source = "./modules/rds"

  name_prefix        = local.name_prefix
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  eks_security_group_id = module.eks.node_security_group_id
  instance_class     = var.rds_instance_class
  allocated_storage  = var.rds_allocated_storage
  db_name            = var.rds_db_name
  master_username    = var.rds_master_username
}

# ─── ElastiCache (Redis) ─────────────────────────────────────
module "elasticache" {
  source = "./modules/elasticache"

  name_prefix           = local.name_prefix
  vpc_id                = module.vpc.vpc_id
  private_subnet_ids    = module.vpc.private_subnet_ids
  eks_security_group_id = module.eks.node_security_group_id
  node_type             = var.redis_node_type
  num_cache_nodes       = var.redis_num_cache_nodes
}

# ─── ACM (SSL Certificate) ───────────────────────────────────
module "acm" {
  source = "./modules/acm"

  domain_name = var.domain_name
}

# ─── ALB ──────────────────────────────────────────────────────
module "alb" {
  source = "./modules/alb"

  name_prefix       = local.name_prefix
  vpc_id            = module.vpc.vpc_id
  public_subnet_ids = module.vpc.public_subnet_ids
  certificate_arn   = module.acm.certificate_arn
}

# ─── Secrets Manager ─────────────────────────────────────────
module "secrets" {
  source = "./modules/secrets"

  name_prefix  = local.name_prefix
  rds_endpoint = module.rds.endpoint
  rds_port     = module.rds.port
  rds_db_name  = var.rds_db_name
  rds_username = var.rds_master_username
  rds_password = module.rds.master_password
  redis_endpoint = module.elasticache.endpoint
  redis_port     = module.elasticache.port
}

