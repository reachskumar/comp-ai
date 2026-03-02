output "repository_url" {
  description = "Full repository URL for docker push/pull"
  value       = "${google_artifact_registry_repository.main.location}-docker.pkg.dev/${google_artifact_registry_repository.main.project}/${google_artifact_registry_repository.main.repository_id}"
}

output "registry_host" {
  description = "Artifact Registry host"
  value       = "${google_artifact_registry_repository.main.location}-docker.pkg.dev"
}

