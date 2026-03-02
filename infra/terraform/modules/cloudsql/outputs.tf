output "instance_name" {
  value = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "Cloud SQL connection name (project:region:instance)"
  value       = google_sql_database_instance.main.connection_name
}

output "private_ip" {
  description = "Private IP address of Cloud SQL instance"
  value       = google_sql_database_instance.main.private_ip_address
}

output "database_name" {
  value = google_sql_database.main.name
}

output "master_password" {
  value     = random_password.master.result
  sensitive = true
}

