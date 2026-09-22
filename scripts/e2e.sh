#!/usr/bin/env bash
# End to end test for the claimpaign CLI, run manually against a real API, not part of
# npm test. Sandbox (Cardano preprod) only, never mainnet.
#
# Requires three environment variables:
#   CLAIMPAIGN_API    API base URL to test against, a local dev server on preprod or
#                      https://claimpaign.com
#   CLAIMPAIGN_TOKEN  sandbox API key of a funded organization, read by the CLI itself,
#                      this script never echoes it
#   E2E_ADDRESSES     path to a file with one addr_test address per line, produced by
#                      scripts/derive-test-addresses.ts --from 1 --to 61 in the
#                      claimpaign.com repo. Line 61 is reserved for the --foreign stage.
#
# Optional:
#   CLI               command used to run the CLI, defaults to this checkout's build
#                      output. Set CLI="npx claimpaign" to test the published package.
#   E2E_FOREIGN_URI   required only together with --foreign, a CIP-99 claim uri from an
#                      external faucet, for example the tUSDM preprod faucet:
#                      web+cardano://claim/v1?faucet_url=https%3A%2F%2Fbeta.onbd.io%2Fapi%2Fclaim%2Fv1%2F01ksj7qeeg0kbh5s64ds2x9yya&code=01KSJ8PW11CPCG40G7S7TVKXZ9
#
# Stages: the smoke stage always runs. --full adds a 60 claim acceptance run (takes at
# least 30 seconds to submit, then polls for up to 20 minutes). --foreign adds a claim
# against an external CIP-99 faucet. Stages can be combined, e.g. --full --foreign.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${CLI:-}" ]; then
  CLI="node $SCRIPT_DIR/../dist/bin.js"
fi

FULL_CLAIM_COUNT=60
FULL_CLAIM_INTERVAL=0.6
FULL_POLL_INTERVAL=20
FULL_POLL_TIMEOUT=1200

usage() {
  cat <<'EOF'
Usage: CLAIMPAIGN_API=... CLAIMPAIGN_TOKEN=... E2E_ADDRESSES=... scripts/e2e.sh [--full] [--foreign]

Required environment variables:
  CLAIMPAIGN_API    API base URL to test against (a local dev server on preprod, or https://claimpaign.com)
  CLAIMPAIGN_TOKEN  sandbox API key of a funded organization
  E2E_ADDRESSES     path to a file with one addr_test address per line, one per claim,
                     produced by scripts/derive-test-addresses.ts --from 1 --to 61 in the
                     claimpaign.com repo (line 61 is reserved for the --foreign stage)

Optional:
  CLI               command to run the CLI (default: node dist/bin.js from this checkout,
                     or CLI="npx claimpaign" for the published package)
  E2E_FOREIGN_URI   required only together with --foreign, a CIP-99 claim uri from an
                     external faucet, for example the tUSDM preprod faucet:
                     web+cardano://claim/v1?faucet_url=https%3A%2F%2Fbeta.onbd.io%2Fapi%2Fclaim%2Fv1%2F01ksj7qeeg0kbh5s64ds2x9yya&code=01KSJ8PW11CPCG40G7S7TVKXZ9

Flags:
  --full      also run 60 claims spaced 0.6 seconds apart, then poll campaign status
              until all 60 are settled
  --foreign   also claim from an external CIP-99 faucet with the last address in
              E2E_ADDRESSES, using the uri in E2E_FOREIGN_URI
EOF
}

for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
  esac
done

for var in CLAIMPAIGN_API CLAIMPAIGN_TOKEN E2E_ADDRESSES; do
  if [ -z "${!var:-}" ]; then
    usage >&2
    exit 2
  fi
done

# Reads a JSON string from $1 and prints the result of the JS expression in $2,
# evaluated with `d` bound to the parsed value. No jq dependency this way.
json_field() {
  node -e '
    const d = JSON.parse(process.argv[1]);
    process.stdout.write(String(eval(process.argv[2])));
  ' "$1" "$2"
}

run_smoke() {
  echo "== smoke stage =="
  rm -rf /tmp/cp-e2e
  mkdir -p /tmp/cp-e2e

  echo "-- balance --"
  $CLI balance

  echo "-- campaign create --"
  local create_out
  create_out="$($CLI --json campaign create --name "CLI e2e" --claims 3 --ada 2 --out /tmp/cp-e2e)"
  local campaign_id codes_file
  campaign_id="$(json_field "$create_out" 'd.campaign.id')"
  codes_file="$(json_field "$create_out" 'd.codesFile')"
  echo "Campaign: $campaign_id"

  echo "-- campaign codes --"
  $CLI campaign codes "$campaign_id" --qr-dir /tmp/cp-e2e/qr --pdf /tmp/cp-e2e/codes.pdf

  local first_code first_addr
  first_code="$(sed -n '2p' "$codes_file" | cut -d',' -f1)"
  first_addr="$(sed -n '1p' "$E2E_ADDRESSES")"
  if [ -z "$first_code" ] || [ -z "$first_addr" ]; then
    echo "Could not read a code from $codes_file or an address from E2E_ADDRESSES" >&2
    exit 1
  fi

  echo "-- claim --"
  $CLI claim "$first_code" "$first_addr"

  echo "-- campaign status --"
  $CLI campaign status "$campaign_id"

  echo "-- campaign end --wait --"
  $CLI campaign end "$campaign_id" --wait

  echo "smoke stage: ok"
}

run_full() {
  echo "== full stage ($FULL_CLAIM_COUNT claims) =="
  rm -rf /tmp/cp-e2e-full
  mkdir -p /tmp/cp-e2e-full

  echo "-- campaign create ($FULL_CLAIM_COUNT codes) --"
  local create_out campaign_id
  create_out="$($CLI --json campaign create --name "CLI full e2e" --claims "$FULL_CLAIM_COUNT" --ada 2 --out /tmp/cp-e2e-full)"
  campaign_id="$(json_field "$create_out" 'd.campaign.id')"
  echo "Campaign: $campaign_id"

  echo "-- campaign codes (csv + pdf) --"
  local csv_path=/tmp/cp-e2e-full/codes.csv
  $CLI campaign codes "$campaign_id" --csv "$csv_path" --pdf /tmp/cp-e2e-full/codes.pdf

  echo "-- $FULL_CLAIM_COUNT claims, $FULL_CLAIM_INTERVAL seconds apart --"
  local accepted=0
  local i row code addr claim_out claim_status exit_code
  for i in $(seq 1 "$FULL_CLAIM_COUNT"); do
    row="$(sed -n "$((i + 1))p" "$csv_path")"
    code="${row%%,*}"
    addr="$(sed -n "${i}p" "$E2E_ADDRESSES")"
    if [ -z "$code" ] || [ -z "$addr" ]; then
      echo "Missing code (row $i of $csv_path) or address (line $i of E2E_ADDRESSES)" >&2
      exit 1
    fi

    set +e
    claim_out="$($CLI --json claim "$code" "$addr")"
    exit_code=$?
    set -e

    if [ "$exit_code" -eq 0 ]; then
      accepted=$((accepted + 1))
    else
      claim_status="$(json_field "$claim_out" "d.status" 2>/dev/null || echo "unknown")"
      if [ "$claim_status" = "ratelimited" ]; then
        echo "Claim $i of $FULL_CLAIM_COUNT was ratelimited, aborting" >&2
      else
        echo "Claim $i of $FULL_CLAIM_COUNT failed with status $claim_status" >&2
      fi
      exit 1
    fi

    sleep "$FULL_CLAIM_INTERVAL"
  done
  echo "Accepted: $accepted/$FULL_CLAIM_COUNT"

  echo "-- polling campaign status until codes_claimed reaches $FULL_CLAIM_COUNT --"
  local deadline claimed pending queued processing status_out
  deadline=$(( $(date +%s) + FULL_POLL_TIMEOUT ))
  while :; do
    status_out="$($CLI --json campaign status "$campaign_id")"
    claimed="$(json_field "$status_out" 'd.campaign.codes_claimed')"
    pending="$(json_field "$status_out" 'd.queue.pending')"
    queued="$(json_field "$status_out" 'd.queue.queued')"
    processing="$(json_field "$status_out" 'd.queue.processing')"
    echo "codes_claimed=$claimed queue.pending=$pending queue.queued=$queued queue.processing=$processing"
    if [ "$claimed" -ge "$FULL_CLAIM_COUNT" ]; then
      break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "Timed out after $((FULL_POLL_TIMEOUT / 60)) minutes waiting for codes_claimed to reach $FULL_CLAIM_COUNT, still at $claimed" >&2
      echo "Queue: pending=$pending queued=$queued processing=$processing" >&2
      exit 1
    fi
    sleep "$FULL_POLL_INTERVAL"
  done

  echo "-- campaign end --wait --"
  $CLI campaign end "$campaign_id" --wait

  echo "full stage: ok"
}

run_foreign() {
  echo "== foreign faucet stage =="
  if [ -z "${E2E_FOREIGN_URI:-}" ]; then
    echo "E2E_FOREIGN_URI is required together with --foreign" >&2
    usage >&2
    exit 2
  fi
  local addr
  addr="$(sed -n '61p' "$E2E_ADDRESSES")"
  if [ -z "$addr" ]; then
    echo "E2E_ADDRESSES needs at least 61 lines, line 61 is reserved for the foreign faucet stage" >&2
    exit 2
  fi

  local claim_out exit_code tokens
  set +e
  claim_out="$($CLI --json claim "$E2E_FOREIGN_URI" "$addr")"
  exit_code=$?
  set -e

  if [ "$exit_code" -ne 0 ]; then
    echo "Foreign faucet claim was not accepted" >&2
    exit 1
  fi
  tokens="$(json_field "$claim_out" 'JSON.stringify(d.tokens || {})')"
  echo "Foreign faucet: accepted, tokens $tokens"

  echo "foreign stage: ok"
}

main() {
  local full=false
  local foreign=false
  for arg in "$@"; do
    case "$arg" in
      --full) full=true ;;
      --foreign) foreign=true ;;
      -h|--help) usage; exit 0 ;;
      *)
        echo "Unknown argument: $arg" >&2
        usage >&2
        exit 2
        ;;
    esac
  done

  run_smoke
  if [ "$full" = true ]; then run_full; fi
  if [ "$foreign" = true ]; then run_foreign; fi

  echo "e2e: ok"
}

main "$@"
