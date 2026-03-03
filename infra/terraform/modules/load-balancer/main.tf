# ─── External IP ─────────────────────────────────────────────
resource "google_compute_global_address" "main" {
  name = "${var.name_prefix}-lb-ip"
}

# ─── Managed SSL Certificate ────────────────────────────────
resource "google_compute_managed_ssl_certificate" "main" {
  name = "${var.name_prefix}-ssl"

  managed {
    domains = [var.domain_name]
  }
}

# ─── Wildcard SSL Certificate (tenant subdomains) ──────────
resource "google_compute_managed_ssl_certificate" "wildcard" {
  count = var.wildcard_domain != "" ? 1 : 0
  name  = "${var.name_prefix}-wildcard-ssl"

  managed {
    domains = [var.wildcard_domain]
  }
}

# ─── Serverless NEGs (Cloud Run backends) ────────────────────
resource "google_compute_region_network_endpoint_group" "api" {
  name                  = "${var.name_prefix}-api-neg"
  region                = var.gcp_region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.api_service_name
  }
}

resource "google_compute_region_network_endpoint_group" "web" {
  name                  = "${var.name_prefix}-web-neg"
  region                = var.gcp_region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = var.web_service_name
  }
}

# ─── Backend Services ───────────────────────────────────────
resource "google_compute_backend_service" "api" {
  name                  = "${var.name_prefix}-api-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.main.id

  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }
}

resource "google_compute_backend_service" "web" {
  name                  = "${var.name_prefix}-web-backend"
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.main.id

  backend {
    group = google_compute_region_network_endpoint_group.web.id
  }
}

# ─── URL Map (path routing) ─────────────────────────────────
resource "google_compute_url_map" "main" {
  name            = "${var.name_prefix}-urlmap"
  default_service = google_compute_backend_service.web.id

  host_rule {
    hosts        = [var.domain_name]
    path_matcher = "main"
  }

  # Wildcard subdomain host rule — routes *.compportiq.ai to the same backends
  dynamic "host_rule" {
    for_each = var.wildcard_domain != "" ? [1] : []
    content {
      hosts        = [var.wildcard_domain]
      path_matcher = "main"
    }
  }

  path_matcher {
    name            = "main"
    default_service = google_compute_backend_service.web.id

    path_rule {
      paths   = ["/api/*"]
      service = google_compute_backend_service.api.id
    }
  }
}

# ─── HTTPS Target Proxy ─────────────────────────────────────
resource "google_compute_target_https_proxy" "main" {
  name             = "${var.name_prefix}-https-proxy"
  url_map          = google_compute_url_map.main.id
  ssl_certificates = concat(
    [google_compute_managed_ssl_certificate.main.id],
    var.wildcard_domain != "" ? [google_compute_managed_ssl_certificate.wildcard[0].id] : [],
  )
}

# ─── HTTPS Forwarding Rule ──────────────────────────────────
resource "google_compute_global_forwarding_rule" "https" {
  name                  = "${var.name_prefix}-https"
  target                = google_compute_target_https_proxy.main.id
  port_range            = "443"
  ip_address            = google_compute_global_address.main.address
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ─── HTTP → HTTPS Redirect ─────────────────────────────────
resource "google_compute_url_map" "http_redirect" {
  name = "${var.name_prefix}-http-redirect"

  default_url_redirect {
    https_redirect         = true
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "${var.name_prefix}-http-proxy"
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "${var.name_prefix}-http-redirect"
  target                = google_compute_target_http_proxy.redirect.id
  port_range            = "80"
  ip_address            = google_compute_global_address.main.address
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# ─── Cloud Armor Security Policy ────────────────────────────
resource "google_compute_security_policy" "main" {
  name = "${var.name_prefix}-security-policy"

  # Default rule: allow all
  rule {
    action   = "allow"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Default allow rule"
  }

  # Rate limiting: 1000 requests per minute per IP
  rule {
    action   = "rate_based_ban"
    priority = "1000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      rate_limit_threshold {
        count        = 1000
        interval_sec = 60
      }
      ban_duration_sec = 300
    }
    description = "Rate limit: 1000 req/min per IP"
  }
}

