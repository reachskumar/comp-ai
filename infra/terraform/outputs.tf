# ─── VPC ──────────────────────────────────────────────────────
output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

# ─── EKS ──────────────────────────────────────────────────────
output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
}

output "eks_cluster_ca_certificate" {
  description = "EKS cluster CA certificate (base64)"
  value       = module.eks.cluster_ca_certificate
  sensitive   = true
}

# ─── ECR ──────────────────────────────────────────────────────
output "ecr_api_repository_url" {
  description = "ECR repository URL for API image"
  value       = module.ecr.api_repository_url
}

output "ecr_web_repository_url" {
  description = "ECR repository URL for Web image"
  value       = module.ecr.web_repository_url
}

# ─── RDS ──────────────────────────────────────────────────────
output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.endpoint
}

# ─── ElastiCache ──────────────────────────────────────────────
output "redis_endpoint" {
  description = "ElastiCache Redis endpoint"
  value       = module.elasticache.endpoint
}

# ─── ALB ──────────────────────────────────────────────────────
output "alb_dns_name" {
  description = "ALB DNS name (point your domain CNAME here)"
  value       = module.alb.dns_name
}

output "alb_zone_id" {
  description = "ALB hosted zone ID (for Route53 alias record)"
  value       = module.alb.zone_id
}

# ─── ACM ──────────────────────────────────────────────────────
output "acm_certificate_arn" {
  description = "ACM certificate ARN"
  value       = module.acm.certificate_arn
}

# ─── Secrets ──────────────────────────────────────────────────
output "secrets_arns" {
  description = "Map of Secrets Manager secret ARNs"
  value       = module.secrets.secret_arns
}

