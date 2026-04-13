# CompportIQ Kubernetes Deployment

## Architecture

```
GKE Cluster (asia-south1, regional)
├── Namespace: compportiq
│   ├── Deployment: api (3 replicas, HPA 3-20, anti-affinity across zones)
│   ├── Deployment: web (2 replicas, HPA 2-10)
│   ├── Deployment: sync-worker (2 replicas, spot instances, tolerations for worker pool)
│   ├── Service: api (ClusterIP)
│   ├── Service: web (ClusterIP)
│   ├── Ingress: GCE with managed TLS certificate
│   └── PodDisruptionBudget: min 1 for api + web
├── Namespace: monitoring
│   ├── Prometheus (scrapes /metrics every 15s)
│   ├── Grafana (dashboards)
│   └── Alertmanager (Slack alerts)
└── Node Pools:
    ├── default: e2-standard-4 (API + Web, 2-10 nodes)
    └── workers: e2-standard-8 (sync workers, spot, 1-5 nodes)
```

## Prerequisites

1. GKE cluster created via Terraform:
   ```bash
   cd infra/terraform
   terraform apply -target=module.gke
   ```

2. kubectl configured:
   ```bash
   gcloud container clusters get-credentials compportiq-prod-cluster \
     --region asia-south1 --project compportiq
   ```

3. Secrets created:
   ```bash
   kubectl create namespace compportiq
   kubectl create secret generic api-secrets -n compportiq \
     --from-literal=DATABASE_URL="$(gcloud secrets versions access latest --secret=compportiq-prod-database-url)" \
     --from-literal=REDIS_URL="$(gcloud secrets versions access latest --secret=compportiq-prod-redis-url)" \
     --from-literal=JWT_SECRET="$(gcloud secrets versions access latest --secret=compportiq-prod-jwt-secret)" \
     --from-literal=INTEGRATION_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=compportiq-prod-encryption-key)" \
     --from-literal=BENEFITS_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=compportiq-prod-benefits-encryption-key)" \
     --from-literal=PLATFORM_CONFIG_ENCRYPTION_KEY="$(gcloud secrets versions access latest --secret=compportiq-prod-platform-config-encryption-key)" \
     --from-literal=AZURE_OPENAI_API_KEY="$(gcloud secrets versions access latest --secret=compportiq-prod-azure-openai-key)" \
     --from-literal=AZURE_OPENAI_ENDPOINT="$(gcloud secrets versions access latest --secret=compportiq-prod-azure-openai-endpoint)" \
     --from-literal=DB_HOST="10.0.16.2" \
     --from-literal=DB_USER="$(gcloud secrets versions access latest --secret=DB_USER-uat-db)" \
     --from-literal=DB_PWD="$(gcloud secrets versions access latest --secret=DB_PWD-uat-db)"
   kubectl create secret generic web-secrets -n compportiq \
     --from-literal=NEXTAUTH_SECRET="$(gcloud secrets versions access latest --secret=compportiq-prod-nextauth-secret)" \
     --from-literal=NEXT_PUBLIC_API_URL="https://compportiq.ai"
   ```

## Deploy

```bash
# Apply all base manifests
kubectl apply -f base/

# Install monitoring stack
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  -f monitoring/prometheus.yaml
```

## Migration from Cloud Run

1. Deploy to GKE (parallel with Cloud Run)
2. Verify health: `kubectl get pods -n compportiq`
3. Update DNS to point to GKE ingress IP
4. Monitor for 24h
5. Decommission Cloud Run services

## Monitoring

- Grafana: https://grafana.compportiq.ai
- Prometheus: port-forward 9090
- Alerts: #compportiq-alerts Slack channel

### Custom alerts:
- **HighErrorRate**: API 5xx rate > 5% for 5 min → critical
- **HighLatency**: p95 > 5s for 5 min → warning
- **SyncJobStuck**: No sync completion in 10 min → warning
- **PodCrashLooping**: Container restart detected → critical
