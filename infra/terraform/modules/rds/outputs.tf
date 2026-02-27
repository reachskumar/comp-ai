output "endpoint" {
  value = aws_db_instance.main.address
}

output "port" {
  value = aws_db_instance.main.port
}

output "master_password" {
  value     = random_password.master.result
  sensitive = true
}

