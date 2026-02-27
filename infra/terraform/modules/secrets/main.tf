# ─── Database URL Secret ─────────────────────────────────────
resource "aws_secretsmanager_secret" "database_url" {
  name        = "${var.name_prefix}/database-url"
  description = "PostgreSQL connection string for CompportIQ"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.rds_username}:${var.rds_password}@${var.rds_endpoint}:${var.rds_port}/${var.rds_db_name}?sslmode=require"
}

# ─── Redis URL Secret ────────────────────────────────────────
resource "aws_secretsmanager_secret" "redis_url" {
  name        = "${var.name_prefix}/redis-url"
  description = "Redis connection string for CompportIQ"
}

resource "aws_secretsmanager_secret_version" "redis_url" {
  secret_id     = aws_secretsmanager_secret.redis_url.id
  secret_string = "redis://${var.redis_endpoint}:${var.redis_port}"
}

# ─── JWT Secret ──────────────────────────────────────────────
resource "random_password" "jwt_secret" {
  length  = 64
  special = true
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name        = "${var.name_prefix}/jwt-secret"
  description = "JWT signing secret for CompportIQ"
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

# ─── NextAuth Secret ─────────────────────────────────────────
resource "random_password" "nextauth_secret" {
  length  = 64
  special = true
}

resource "aws_secretsmanager_secret" "nextauth_secret" {
  name        = "${var.name_prefix}/nextauth-secret"
  description = "NextAuth session secret for CompportIQ"
}

resource "aws_secretsmanager_secret_version" "nextauth_secret" {
  secret_id     = aws_secretsmanager_secret.nextauth_secret.id
  secret_string = random_password.nextauth_secret.result
}

# ─── Azure OpenAI Secret (placeholder) ───────────────────────
resource "aws_secretsmanager_secret" "azure_openai" {
  name        = "${var.name_prefix}/azure-openai"
  description = "Azure OpenAI credentials for CompportIQ"
}

# ─── Azure AD Secret (placeholder) ───────────────────────────
resource "aws_secretsmanager_secret" "azure_ad" {
  name        = "${var.name_prefix}/azure-ad"
  description = "Azure AD app credentials for CompportIQ SSO"
}

