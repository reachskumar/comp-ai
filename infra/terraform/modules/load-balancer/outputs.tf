output "load_balancer_ip" {
  description = "Global external IP address for DNS"
  value       = google_compute_global_address.main.address
}

output "ssl_certificate_status" {
  description = "SSL certificate provisioning status"
  value       = google_compute_managed_ssl_certificate.main.managed[0].status
}

