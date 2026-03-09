terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "gcs" {
    bucket = "compportiq-terraform-state"
    # prefix is set per-environment via -backend-config:
    #   terraform init -backend-config=environments/prod/backend.tfvars
    #   terraform init -backend-config=environments/staging/backend.tfvars
  }
}

