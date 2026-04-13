# ─── GKE VPC (in compportiq project, avoids cross-project VPC complexity) ──

resource "google_compute_network" "gke" {
  name                    = "${var.name_prefix}-gke-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "gke" {
  name          = "${var.name_prefix}-gke-subnet"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.gke.id
  ip_cidr_range = "10.100.0.0/20"

  secondary_ip_range {
    range_name    = "gke-pods"
    ip_cidr_range = "10.104.0.0/14"
  }

  secondary_ip_range {
    range_name    = "gke-services"
    ip_cidr_range = "10.108.0.0/20"
  }

  private_ip_google_access = true
}

# Peering to the existing VPC (for Cloud SQL + Redis access)
resource "google_compute_network_peering" "gke_to_existing" {
  name         = "${var.name_prefix}-gke-to-existing"
  network      = google_compute_network.gke.id
  peer_network = var.existing_vpc_id

  export_custom_routes = true
  import_custom_routes = true
}

resource "google_compute_network_peering" "existing_to_gke" {
  name         = "${var.name_prefix}-existing-to-gke"
  network      = var.existing_vpc_id
  peer_network = google_compute_network.gke.id

  export_custom_routes = true
  import_custom_routes = true

  depends_on = [google_compute_network_peering.gke_to_existing]
}

# ─── GKE Cluster ──────────────────────────────────────────

resource "google_container_cluster" "primary" {
  name     = "${var.name_prefix}-cluster"
  location = var.region
  project  = var.project_id

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.gke.id
  subnetwork = google_compute_subnetwork.gke.id

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
  }

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }

  logging_service    = "logging.googleapis.com/kubernetes"
  monitoring_service = "monitoring.googleapis.com/kubernetes"

  maintenance_policy {
    daily_maintenance_window {
      start_time = "20:30" # UTC = 2:00 AM IST
    }
  }

  resource_labels = var.labels
}

# ─── Node Pool: API + Web ─────────────────────────────────

resource "google_container_node_pool" "default" {
  name     = "${var.name_prefix}-default"
  location = var.region
  cluster  = google_container_cluster.primary.name

  autoscaling {
    min_node_count = var.api_min_nodes
    max_node_count = var.api_max_nodes
  }

  node_config {
    machine_type = var.api_machine_type
    disk_size_gb = 50
    disk_type    = "pd-ssd"

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    labels = merge(var.labels, { pool = "default" })
    tags   = ["gke-node", "${var.name_prefix}-default"]
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

# ─── Node Pool: Sync Workers (spot instances) ────────────

resource "google_container_node_pool" "workers" {
  name     = "${var.name_prefix}-workers"
  location = var.region
  cluster  = google_container_cluster.primary.name

  autoscaling {
    min_node_count = var.worker_min_nodes
    max_node_count = var.worker_max_nodes
  }

  node_config {
    machine_type = var.worker_machine_type
    disk_size_gb = 100
    disk_type    = "pd-ssd"
    spot         = true

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    labels = merge(var.labels, { pool = "workers" })
    tags   = ["gke-node", "${var.name_prefix}-workers"]

    taint {
      key    = "workload"
      value  = "sync"
      effect = "NO_SCHEDULE"
    }
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}
