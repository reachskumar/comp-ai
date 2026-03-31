output "load_balancer_ip" {
  description = "Global external IP address for DNS"
  value       = google_compute_global_address.main.address
}

output "certificate_map_id" {
  description = "Certificate Manager certificate map ID"
  value       = google_certificate_manager_certificate_map.main.id
}

output "certificate_name" {
  description = "Certificate Manager certificate name"
  value       = google_certificate_manager_certificate.main.name
}

output "dns_auth_record" {
  description = "DNS authorization CNAME record details"
  value = {
    name = google_certificate_manager_dns_authorization.main.dns_resource_record[0].name
    type = google_certificate_manager_dns_authorization.main.dns_resource_record[0].type
    data = google_certificate_manager_dns_authorization.main.dns_resource_record[0].data
  }
}

