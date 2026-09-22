# claimpaign

Command line tool for Claimpaign sandbox campaigns and CIP-99 claims. It creates and manages campaigns from the terminal, and claims CIP-99 codes on the Cardano preprod testnet.

## Install

```
npx claimpaign --help
```

Or install it globally:

```
npm install -g claimpaign
```

## Login

Run `claimpaign login` and paste your sandbox API key when prompted. Get a key from Settings, Sandbox API on claimpaign.com, it looks like `cps_` followed by 40 characters. To skip the prompt, for example in CI, set `CLAIMPAIGN_TOKEN` instead, the CLI reads it directly.

## Hackathon flow

1. Deposit test tokens into the org wallet, or top up sandbox credits in the web interface. `claimpaign deposit` shows the wallet address and the top up link.
2. `claimpaign campaign create --name "..." --claims 50 --ada 2` creates a campaign and exports its codes. Run one `campaign create` at a time, two parallel creations would produce two funded campaigns.
3. `claimpaign campaign codes <id> --qr-dir ./qr --pdf codes.pdf` prints QR codes and a cut sheet PDF.
4. Hand out the codes, on paper or as QR images.
5. `claimpaign campaign status <id>` shows how many codes are claimed.
6. `claimpaign campaign end <id>` ends the campaign and refunds unclaimed credits.

## For participants

```
claimpaign claim <uri-or-code> <addr_test...>
```

Works with a scanned CIP-99 claim URI, or a bare code together with `--faucet <url>`. Also works against other CIP-99 faucets, not just Claimpaign campaigns.

Sandbox (Cardano preprod) only, never mainnet.

## Exit codes

- `0` success
- `1` the command ran but failed, an API error, a rejected claim, a network problem
- `2` usage error, bad arguments or a missing required environment variable
- `130` the login prompt was cancelled (Ctrl-C)

## JSON output

Every command accepts a top level `--json` flag, which prints the shape below instead of the human readable text. Fields marked `?` are only present when the value applies.

- `login` no stdout output, only the exit code and the stored config change
- `logout` no stdout output, only the exit code and the stored config change
- `balance` `{ credits: <raw org credits body>, wallet: <raw org wallet body> }`
- `deposit` `{ address, network }`
- `campaign create` `{ campaign: { id, status, codePrefix, totalCodes }, pricing?, codesFile?, exportError? }`
- `campaign list` `{ campaigns: [...] }`
- `campaign status` the raw campaign GET body, `{ campaign, codes, queue, pagination }`
- `campaign codes` without `--csv`/`--qr-dir`/`--pdf`, `{ campaign: { id, name, codePrefix }, codes: [{ code, status, claim_uri, fallback_url }] }`
- `campaign codes` with `--csv`/`--qr-dir`/`--pdf`, `{ csv?, qrDir?, pdf?, count }`
- `campaign end` the raw endpoint body, `{ ok, status, refunded? }`
- `campaign pause` / `campaign resume` the raw endpoint body, `{ ok, status }`
- `claim` the raw faucet response body, `{ code, status, message?, lovelaces?, tokens?, queue_position? }`, printed even when the claim is not accepted, before the command exits with an error

## Configuration

The CLI stores its login in `~/.config/claimpaign/config.json` (mode 0600).

- `CLAIMPAIGN_API` API base URL, overrides the stored one and the default `https://claimpaign.com`
- `CLAIMPAIGN_TOKEN` sandbox API key, overrides the stored one and skips the login prompt
- `CLAIMPAIGN_CONFIG_DIR` directory for `config.json`, default `~/.config/claimpaign`

## Development

From a checkout: `npm install && npm run build`, then `node dist/bin.js --help`, or `npm link` once to get the `claimpaign` command. `npx claimpaign` only works with the published package.

```
npm test
```

`scripts/e2e.sh` runs an end to end test against a real API, not part of `npm test`. It needs `CLAIMPAIGN_API`, `CLAIMPAIGN_TOKEN` and `E2E_ADDRESSES` (a file with one `addr_test` address per line) as environment variables. The default run is a smoke test, `--full` adds a 60 claim acceptance run, `--foreign` adds a claim against an external CIP-99 faucet and needs `E2E_FOREIGN_URI` (a CIP-99 claim uri, for example the tUSDM preprod faucet).

## Documentation

https://claimpaign.com/docs

## License

Apache 2.0
