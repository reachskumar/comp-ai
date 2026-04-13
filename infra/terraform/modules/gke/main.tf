# ─── GKE Cluster ──────────────────────────────────────────
# Regional cluster replacing Cloud Run for better performance,
# persistent pods, GPU support, and monitoring.

resource "google_container_cluster" "primary" {
  name     = "${var.name_prefix}-cluster"
  location = var.region

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = var.vpc_id
  subnetwork = var.subnet_id

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"
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

  labels = var.labels
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
