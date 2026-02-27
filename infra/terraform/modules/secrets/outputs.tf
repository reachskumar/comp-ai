output "secret_arns" {
  description = "Map of secret name to ARN"
  value = {
    database_url   = aws_secretsmanager_secret.database_url.arn
    redis_url      = aws_secretsmanager_secret.redis_url.arn
    jwt_secret     = aws_secretsmanager_secret.jwt_secret.arn
    nextauth_secret = aws_secretsmanager_secret.nextauth_secret.arn
    azure_openai   = aws_secretsmanager_secret.azure_openai.arn
    azure_ad       = aws_secretsmanager_secret.azure_ad.arn
  }
}

