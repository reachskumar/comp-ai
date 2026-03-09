output "load_balancer_ip" {
  description = "Global external IP address for DNS"
  value       = google_compute_global_address.main.address
}

output "ssl_certificate_name" {
  description = "SSL certificate resource name"
  value       = google_compute_managed_ssl_certificate.main.name
}

