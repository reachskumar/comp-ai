# ─── VPC ──────────────────────────────────────────────────────
resource "google_compute_network" "main" {
  name                    = "${var.name_prefix}-vpc"
  auto_create_subnetworks = false
}

# ─── Subnets ─────────────────────────────────────────────────
resource "google_compute_subnetwork" "cloudrun" {
  name          = "${var.name_prefix}-cloudrun"
  ip_cidr_range = "10.0.0.0/20"
  region        = var.gcp_region
  network       = google_compute_network.main.id

  private_ip_google_access = true
}

resource "google_compute_subnetwork" "data" {
  name          = "${var.name_prefix}-data"
  ip_cidr_range = "10.0.16.0/20"
  region        = var.gcp_region
  network       = google_compute_network.main.id

  private_ip_google_access = true
}

# ─── Cloud Router + Cloud NAT (outbound internet for Cloud Run) ─
resource "google_compute_router" "main" {
  name    = "${var.name_prefix}-router"
  region  = var.gcp_region
  network = google_compute_network.main.id
}

resource "google_compute_router_nat" "main" {
  name                               = "${var.name_prefix}-nat"
  router                             = google_compute_router.main.name
  region                             = var.gcp_region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"

  log_config {
    enable = true
    filter = "ERRORS_ONLY"
  }
}

# ─── Private Services Access (Cloud SQL + Memorystore) ───────
resource "google_compute_global_address" "private_services" {
  name          = "${var.name_prefix}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# ─── Serverless VPC Access Connector (Cloud Run → VPC) ──────
resource "google_vpc_access_connector" "main" {
  name          = "${var.name_prefix}-conn"
  region        = var.gcp_region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.main.name

  min_instances = 2
  max_instances = 3

  machine_type = "e2-micro"
}

# ─── Firewall Rules ─────────────────────────────────────────
resource "google_compute_firewall" "allow_internal" {
  name    = "${var.name_prefix}-allow-internal"
  network = google_compute_network.main.name

  allow {
    protocol = "tcp"
    ports    = ["0-65535"]
  }
  allow {
    protocol = "udp"
    ports    = ["0-65535"]
  }
  allow {
    protocol = "icmp"
  }

  source_ranges = ["10.0.0.0/8"]
}

resource "google_compute_firewall" "deny_all_ingress" {
  name    = "${var.name_prefix}-deny-all-ingress"
  network = google_compute_network.main.name

  deny {
    protocol = "all"
  }

  source_ranges = ["0.0.0.0/0"]
  priority      = 65534
}

