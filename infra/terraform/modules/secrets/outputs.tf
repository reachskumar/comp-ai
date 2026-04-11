output "secret_ids" {
  description = "Map of secret name to Secret Manager secret ID"
  value = {
    database_url                    = google_secret_manager_secret.database_url.secret_id
    redis_url                       = google_secret_manager_secret.redis_url.secret_id
    jwt_secret                      = google_secret_manager_secret.jwt_secret.secret_id
    nextauth_secret                 = google_secret_manager_secret.nextauth_secret.secret_id
    encryption_key                  = google_secret_manager_secret.encryption_key.secret_id
    benefits_encryption_key         = google_secret_manager_secret.benefits_encryption_key.secret_id
    platform_config_encryption_key  = google_secret_manager_secret.platform_config_encryption_key.secret_id
    azure_openai_key                = google_secret_manager_secret.azure_openai_key.secret_id
    azure_openai_endpoint           = google_secret_manager_secret.azure_openai_endpoint.secret_id
  }
}

