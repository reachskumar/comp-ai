output "dns_name" {
  value = aws_lb.main.dns_name
}

output "zone_id" {
  value = aws_lb.main.zone_id
}

output "arn" {
  value = aws_lb.main.arn
}

output "https_listener_arn" {
  value = aws_lb_listener.https.arn
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

