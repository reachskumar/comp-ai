output "host" {
  description = "Redis instance host (private IP)"
  value       = google_redis_instance.main.host
}

output "port" {
  description = "Redis instance port"
  value       = google_redis_instance.main.port
}

output "auth_string" {
  description = "Redis AUTH string"
  value       = google_redis_instance.main.auth_string
  sensitive   = true
}

