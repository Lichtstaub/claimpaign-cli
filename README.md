# claimpaign

Command line tool for Claimpaign sandbox campaigns and CIP-99 claims. It is made for events like hackathons, workshops and school classes where many people need preprod ada or test tokens quickly: the organizer creates a campaign in the web interface, exports its codes or QR cards from the terminal and hands them out, participants claim without owning a wallet yet, and test tokens such as tUSDM can be handed out the same way. It also claims CIP-99 codes from other faucets on the Cardano preprod testnet.

## Install

```
npx claimpaign --help
```

Or install it globally:

```
npm install -g claimpaign
```

## Login

Run `claimpaign login` and paste your sandbox API key when prompted. Get a key from Settings, Sandbox API on claimpaign.com, it looks like `cps_` followed by 40 characters. Setting `CLAIMPAIGN_TOKEN` skips `claimpaign login` entirely, every command reads it before anything else. `claimpaign login` itself always prompts for a key even when the variable is set, its whole purpose is storing a key in the config file.

<img width="800" alt="api-key-settings" src="https://github.com/user-attachments/assets/4c347ed5-eeb6-4fdf-8bf7-3cab5e380b3b" />


## Hackathon flow

1. Top up sandbox credits and create the campaign in the web interface at https://claimpaign.com/admin/create/. `claimpaign deposit` shows the links. Test tokens such as tUSDM are paid with credits when the campaign is created.
2. `claimpaign campaign list` shows the campaign id.
3. `claimpaign campaign codes <id> --qr-dir ./qr --pdf codes.pdf` prints QR codes and a cut sheet PDF, `--csv codes.csv` exports the codes.
4. Hand out the codes, on paper or as QR images.
5. `claimpaign campaign status <id>` shows how many codes are claimed.
6. `claimpaign campaign end <id>` ends the campaign and refunds unclaimed credits.

`claimpaign campaign create` no longer creates campaigns, it prints the link to the web interface.

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
- `balance` `{ credits: <raw org credits body> }`
- `deposit` `{ topupUrl, faucetUrl }`
- `campaign create` `{ createUrl, pendingCreate }`, printed before the command exits with an error. `pendingCreate` is `null` or `{ api, name, codePrefix, codeCount, createdAt }` of a creation an earlier version left unfinished
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

`scripts/e2e.sh` runs an end to end test against a real API, not part of `npm test`. It needs `CLAIMPAIGN_API`, `CLAIMPAIGN_TOKEN`, `E2E_ADDRESSES` (a file with one `addr_test` address per line) and `E2E_CAMPAIGN_ID` (an ada campaign with at least one unclaimed code, created in the web interface) as environment variables. The default run is a smoke test, `--full` adds a 60 claim acceptance run and needs `E2E_FULL_CAMPAIGN_ID` (an active campaign with 60 codes and no claims yet), `--foreign` adds a claim against an external CIP-99 faucet and needs `E2E_FOREIGN_URI` (a CIP-99 claim uri, for example the tUSDM preprod faucet). The smoke stage ends `E2E_CAMPAIGN_ID` and `--full` ends `E2E_FULL_CAMPAIGN_ID`, so create fresh campaigns in the web interface before every run.

## Releasing

Releases are published to npm by the release workflow, never from a local machine.

1. Bump the version on a branch with `npm version minor --no-git-tag-version` (or `patch`), open a PR and squash merge it.
2. Tag the merge commit on `main` and push the tag: `git tag -a v0.2.0 -m v0.2.0 && git push origin v0.2.0`.
3. Approve the staged version on npmjs.com under Staged Packages (asks for 2FA). Only then is it installable.

The workflow checks that the tag matches `package.json` and sits on `main`, runs typecheck, tests and build, stages the version on npm with provenance and creates the GitHub release. If the workflow fails after staging, approve the staged version first and then rerun it, it skips npm when that version already came from the same commit.

## Documentation

https://claimpaign.com/docs

## License

Apache 2.0
