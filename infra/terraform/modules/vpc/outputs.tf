output "vpc_id" {
  description = "VPC self link"
  value       = google_compute_network.main.id
}

output "vpc_name" {
  description = "VPC name"
  value       = google_compute_network.main.name
}

output "cloudrun_subnet_id" {
  description = "Cloud Run subnet self link"
  value       = google_compute_subnetwork.cloudrun.id
}

output "data_subnet_id" {
  description = "Data services subnet self link"
  value       = google_compute_subnetwork.data.id
}

output "private_services_address" {
  description = "Private services access address name"
  value       = google_compute_global_address.private_services.name
}

output "vpc_connector_id" {
  description = "Serverless VPC Access Connector ID"
  value       = google_vpc_access_connector.main.id
}

