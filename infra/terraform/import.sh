#!/bin/bash
set -e
VARS="-var-file=environments/prod/terraform.tfvars"
P="compportiq"
R="asia-south1"
API_SA="serviceAccount:compportiq-prod-api@compportiq.iam.gserviceaccount.com"
WEB_SA="serviceAccount:compportiq-prod-web@compportiq.iam.gserviceaccount.com"

import() {
  echo "→ Importing $1"
  terraform import $VARS "$1" "$2" 2>&1 | tail -1
}

echo "═══ Phase 1: APIs ═══"
for api in compute.googleapis.com sqladmin.googleapis.com redis.googleapis.com \
  run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  cloudkms.googleapis.com servicenetworking.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com; do
  import "google_project_service.apis[\"$api\"]" "$P/$api"
done

echo "═══ Phase 2: Service Accounts ═══"
import google_service_account.api "projects/$P/serviceAccounts/compportiq-prod-api@$P.iam.gserviceaccount.com"
import google_service_account.web "projects/$P/serviceAccounts/compportiq-prod-web@$P.iam.gserviceaccount.com"

echo "═══ Phase 3: VPC ═══"
import module.vpc.google_compute_network.main "projects/$P/global/networks/compportiq-prod-vpc"
import module.vpc.google_compute_subnetwork.cloudrun "projects/$P/regions/$R/subnetworks/compportiq-prod-cloudrun"
import module.vpc.google_compute_subnetwork.data "projects/$P/regions/$R/subnetworks/compportiq-prod-data"
import module.vpc.google_compute_router.main "projects/$P/regions/$R/routers/compportiq-prod-router"
import module.vpc.google_compute_router_nat.main "$P/$R/compportiq-prod-router/compportiq-prod-nat"
import module.vpc.google_compute_global_address.private_services "projects/$P/global/addresses/compportiq-prod-private-services"
import module.vpc.google_service_networking_connection.private_services "projects/$P/global/networks/compportiq-prod-vpc:servicenetworking.googleapis.com"
import module.vpc.google_vpc_access_connector.main "projects/$P/locations/$R/connectors/compportiq-prod-conn"
import module.vpc.google_compute_firewall.allow_internal "projects/$P/global/firewalls/compportiq-prod-allow-internal"
import module.vpc.google_compute_firewall.deny_all_ingress "projects/$P/global/firewalls/compportiq-prod-deny-all-ingress"

echo "═══ Phase 4: Cloud SQL ═══"
import module.cloudsql.google_sql_database_instance.main "projects/$P/instances/compportiq-prod-postgres"
import module.cloudsql.google_sql_database.main "projects/$P/instances/compportiq-prod-postgres/databases/compportiq"
import module.cloudsql.google_sql_user.master "$P/compportiq-prod-postgres/compportiq_admin"
import module.cloudsql.random_password.master 'tjmk1sETXNchQHrK16L9zAEp7woEmI6a'

echo "═══ Phase 5: Memorystore ═══"
import module.memorystore.google_redis_instance.main "projects/$P/locations/$R/instances/compportiq-prod-redis"
# redis_auth random_password is declared but unused (redis generates its own auth_string)
import module.memorystore.random_password.redis_auth 'DUMMYVALUE00000000000000000000000'

echo "═══ Phase 6: Artifact Registry ═══"
import module.artifact_registry.google_artifact_registry_repository.main "projects/$P/locations/$R/repositories/compportiq-prod-docker"
import 'module.artifact_registry.google_artifact_registry_repository_iam_member.api_reader' "projects/$P/locations/$R/repositories/compportiq-prod-docker roles/artifactregistry.reader $API_SA"
import 'module.artifact_registry.google_artifact_registry_repository_iam_member.web_reader' "projects/$P/locations/$R/repositories/compportiq-prod-docker roles/artifactregistry.reader $WEB_SA"

echo "═══ Phase 7: Cloud Run ═══"
import module.cloudrun.google_cloud_run_v2_service.api "projects/$P/locations/$R/services/compportiq-prod-api"
import module.cloudrun.google_cloud_run_v2_service.web "projects/$P/locations/$R/services/compportiq-prod-web"
import module.cloudrun.google_cloud_run_v2_service_iam_member.api_public "projects/$P/locations/$R/services/compportiq-prod-api roles/run.invoker allUsers"
import module.cloudrun.google_cloud_run_v2_service_iam_member.web_public "projects/$P/locations/$R/services/compportiq-prod-web roles/run.invoker allUsers"
import module.cloudrun.google_project_iam_member.api_cloudsql "$P roles/cloudsql.client $API_SA"
import module.cloudrun.google_project_iam_member.api_secretmanager "$P roles/secretmanager.secretAccessor $API_SA"
import module.cloudrun.google_project_iam_member.api_logging "$P roles/logging.logWriter $API_SA"
import module.cloudrun.google_project_iam_member.web_secretmanager "$P roles/secretmanager.secretAccessor $WEB_SA"
import module.cloudrun.google_project_iam_member.web_logging "$P roles/logging.logWriter $WEB_SA"

echo "═══ Phase 8: Secrets ═══"
for s in database-url redis-url jwt-secret nextauth-secret encryption-key azure-openai-key azure-openai-endpoint; do
  tf_key=$(echo $s | tr '-' '_')
  import "module.secrets.google_secret_manager_secret.$tf_key" "projects/$P/secrets/compportiq-prod-$s"
done

echo "═══ Phase 9: Secret Versions ═══"
import module.secrets.google_secret_manager_secret_version.database_url "projects/$P/secrets/compportiq-prod-database-url/versions/2"
for s in redis_url jwt_secret nextauth_secret encryption_key azure_openai_key azure_openai_endpoint; do
  import "module.secrets.google_secret_manager_secret_version.$s" "projects/$P/secrets/compportiq-prod-$(echo $s | tr '_' '-')/versions/1"
done

echo "═══ Phase 10: Secret Random Passwords ═══"
import module.secrets.random_password.encryption_key 'IZy3MWGOHTCCsQLig64K8BBVB2MfbSQLdcx1wWkFyvRHBuIsfIz0RHRQ78iVYbHr'

# jwt_secret and nextauth_secret have shell-special chars — write to temp files
JWT_VAL='4alN4A3o!uZyE{zQ:CHd3}_P-M6Eu*kva>*$#(yjRCw:S>G@q-vLWv9iI*qK5t@_'
echo "→ Importing module.secrets.random_password.jwt_secret"
terraform import $VARS module.secrets.random_password.jwt_secret "$JWT_VAL" 2>&1 | tail -1

NEXTAUTH_VAL='<68![i1080UwC2cJ!QV#i13qoq@wQiRRD1KU=)A>x}B=4GOCxTIQsx5i9fKbz7&w'
echo "→ Importing module.secrets.random_password.nextauth_secret"
terraform import $VARS module.secrets.random_password.nextauth_secret "$NEXTAUTH_VAL" 2>&1 | tail -1

echo "═══ Phase 11: Secret IAM ═══"
for s in database-url redis-url jwt-secret encryption-key azure-openai-key azure-openai-endpoint; do
  tf_key=$(echo $s | tr '-' '_')
  import "module.secrets.google_secret_manager_secret_iam_member.api_accessor[\"compportiq-prod-$s\"]" \
    "projects/$P/secrets/compportiq-prod-$s roles/secretmanager.secretAccessor $API_SA"
done
import 'module.secrets.google_secret_manager_secret_iam_member.web_accessor["compportiq-prod-nextauth-secret"]' \
  "projects/$P/secrets/compportiq-prod-nextauth-secret roles/secretmanager.secretAccessor $WEB_SA"

echo "═══ Phase 12: Load Balancer ═══"
import 'module.load_balancer[0].google_compute_global_address.main' "projects/$P/global/addresses/compportiq-prod-lb-ip"
import 'module.load_balancer[0].google_compute_region_network_endpoint_group.api' "projects/$P/regions/$R/networkEndpointGroups/compportiq-prod-api-neg"
import 'module.load_balancer[0].google_compute_region_network_endpoint_group.web' "projects/$P/regions/$R/networkEndpointGroups/compportiq-prod-web-neg"
import 'module.load_balancer[0].google_compute_backend_service.api' "projects/$P/global/backendServices/compportiq-prod-api-backend"
import 'module.load_balancer[0].google_compute_backend_service.web' "projects/$P/global/backendServices/compportiq-prod-web-backend"
import 'module.load_balancer[0].google_compute_url_map.main' "projects/$P/global/urlMaps/compportiq-prod-urlmap"
import 'module.load_balancer[0].google_compute_url_map.http_redirect' "projects/$P/global/urlMaps/compportiq-prod-http-redirect"
import 'module.load_balancer[0].google_compute_target_https_proxy.main' "projects/$P/global/targetHttpsProxies/compportiq-prod-https-proxy"
import 'module.load_balancer[0].google_compute_target_http_proxy.redirect' "projects/$P/global/targetHttpProxies/compportiq-prod-http-proxy"
import 'module.load_balancer[0].google_compute_global_forwarding_rule.https' "projects/$P/global/forwardingRules/compportiq-prod-https"
import 'module.load_balancer[0].google_compute_global_forwarding_rule.http_redirect' "projects/$P/global/forwardingRules/compportiq-prod-http-redirect"
import 'module.load_balancer[0].google_compute_security_policy.main' "projects/$P/global/securityPolicies/compportiq-prod-security-policy"

echo ""
echo "═══ IMPORT COMPLETE ═══"
echo "Run: terraform plan $VARS"

