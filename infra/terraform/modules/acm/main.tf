# ─── ACM Certificate ─────────────────────────────────────────
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = var.domain_name }
}

# NOTE: DNS validation records must be created manually in your DNS provider
# (or via Route53 if the hosted zone is managed here).
# After creating the CNAME records from the certificate validation options,
# the certificate will be validated automatically.
#
# To see the required DNS records after terraform apply:
#   terraform output -json acm_validation_records
output "validation_records" {
  description = "DNS records needed for ACM validation"
  value = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

