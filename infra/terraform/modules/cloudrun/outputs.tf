output "api_service_name" {
  description = "API Cloud Run service name"
  value       = google_cloud_run_v2_service.api.name
}

output "api_service_url" {
  description = "API Cloud Run service URL"
  value       = google_cloud_run_v2_service.api.uri
}

output "web_service_name" {
  description = "Web Cloud Run service name"
  value       = google_cloud_run_v2_service.web.name
}

output "web_service_url" {
  description = "Web Cloud Run service URL"
  value       = google_cloud_run_v2_service.web.uri
}



