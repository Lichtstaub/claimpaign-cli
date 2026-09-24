# claimpaign

Command line tool for Claimpaign sandbox (preprod) campaigns and CIP-99 testnet claims. It is made for hackathons, workshops and school classes where many people need preprod ada or test tokens such as tUSDM quickly. Participants claim their code with a single command. Organizers create the campaign in the web interface and use the terminal to export codes, follow the claims and end the campaign.

**Guide:** a more readable version of this page is at https://claimpaign.com/docs/cli/ (also in [Deutsch](https://claimpaign.com/de/docs/cli/), [Español](https://claimpaign.com/es/docs/cli/) and [日本語](https://claimpaign.com/ja/docs/cli/)). This README is the full reference, the rest of the Claimpaign documentation is at https://claimpaign.com/docs.

## Install

The tool needs Node.js 20 or newer. Run it without installing:

```
npx claimpaign --help
```

Or install it globally with `npm install -g claimpaign`. The examples below use the installed `claimpaign` command. With npx, write `npx claimpaign` instead.

## For participants: claim a code

Claiming needs no account and no API key. Pass the code from your card and your testnet address:

```
claimpaign claim SUMMIT_7K3MQ9XZ4H addr_test1q...
```

A scanned claim link works as well. Put it in quotes, since it contains characters your shell would otherwise interpret:

```
claimpaign claim "web+cardano://claim/v1?faucet_url=...&code=..." addr_test1q...
```

The tool also claims from other CIP-99 faucets on preprod or preview. For a bare code from another faucet, add its URL with `--faucet`:

```
claimpaign claim CODE addr_test1q... --faucet https://example.com/claim
```

Only testnet addresses (`addr_test...`) are accepted. Campaigns with a per wallet limit also need an address with a staking part. The receive address your wallet shows always has one.

## For organizers

### Log in with an API key

1. Open [Settings, Sandbox API](https://claimpaign.com/admin/settings/#sandbox-api) on claimpaign.com
2. Create a key and copy it. It is shown only once and looks like `cps_` followed by 40 characters
3. Run `claimpaign login` and paste the key

<img width="800" alt="api-key-settings" src="https://github.com/user-attachments/assets/4c347ed5-eeb6-4fdf-8bf7-3cab5e380b3b" />

Keep the key secret like a password. You can revoke it in the same settings tab at any time. [Configuration](#configuration) shows how to keep it in a password manager instead of the config file.

API keys only work in the Claimpaign sandbox (Cardano preprod). The server never lets a key touch mainnet, so production campaigns are managed in the web interface only.

### Run an event

1. Top up sandbox credits and create the campaign in the web interface at https://claimpaign.com/admin/create/. `claimpaign deposit` shows the links. Test tokens such as tUSDM are paid with credits when the campaign is created.
2. `claimpaign list` shows the campaign with its code prefix, for example `BORA`.
3. Export the codes as a print-ready PDF with one card per code: `claimpaign codes BORA --pdf codes.pdf`. `--qr-dir ./qr` writes one QR image per code, `--csv codes.csv` a CSV file.
4. Hand out the codes, on paper or as QR images.
5. Check how many codes are claimed while the event runs: `claimpaign status BORA`.
6. End the campaign afterwards to get the credits of unclaimed codes back: `claimpaign end BORA`.

## Commands

`claimpaign --help` lists all commands, `claimpaign <command> --help` shows the options of one command. Every command accepts `--api <url>` and `--json`. Where a command takes `<campaign>`, pass the campaign id, the code prefix in any case (`BORA`, `bora`) or the first three or more characters of the id, as long as no other campaign starts the same way.

For participants, no API key needed:

- `claim <uri-or-code> <address>` claims a CIP-99 code to a testnet address. `--faucet <url>` posts a bare code to another CIP-99 faucet

For organizers, all with an API key except `deposit` and `create`:

- `login` stores a sandbox (preprod) API key, `logout` removes it
- `balance` shows the sandbox credit balance
- `deposit` shows how to add sandbox credits
- `create` prints the link to the web interface, campaigns are created there
- `list` lists your running sandbox campaigns and what one claim pays. `--all` includes ended campaigns
- `status <campaign>` shows a campaign's status, progress and claim queue
- `codes <campaign>` prints the unclaimed codes of a campaign, or exports them with `--pdf <file>` (print-ready cards), `--qr-dir <dir>` (one QR PNG per code) and `--csv <file>`. `--all` includes already claimed codes, `--fallback` puts the HTTPS fallback URL into QR images and cards instead of the wallet deep link
- `end <campaign>` ends a campaign and refunds unclaimed credits. `--wait` keeps retrying while payouts are settling
- `pause <campaign>` and `resume <campaign>` pause and resume a campaign

## Exit codes

- `0` success
- `1` the command ran but failed, an API error, a rejected claim, a network problem
- `2` usage error, bad arguments or a missing required environment variable
- `130` the login prompt was cancelled (Ctrl-C)

## JSON output

Every command accepts a top level `--json` flag, which prints the shape below instead of the human readable text. Fields marked `?` are only present when the value applies.

- `claim` the raw faucet response body, `{ code, status, message?, lovelaces?, tokens?, queue_position? }`, printed even when the claim is not accepted, before the command exits with an error
- `login` no stdout output, only the exit code and the stored config change
- `logout` no stdout output, only the exit code and the stored config change
- `balance` `{ credits: <raw org credits body> }`
- `deposit` `{ topupUrl, faucetUrl }`
- `create` `{ createUrl }`, printed before the command exits with an error
- `list` `{ campaigns: [...] }`, running campaigns only unless `--all`
- `status` the raw campaign GET body, `{ campaign, codes, queue, pagination }`
- `codes` without `--csv`/`--qr-dir`/`--pdf`, `{ campaign: { id, name, codePrefix }, codes: [{ code, status, claim_uri, fallback_url }] }`
- `codes` with `--csv`/`--qr-dir`/`--pdf`, `{ csv?, qrDir?, pdf?, count }`
- `end` the raw endpoint body, `{ ok, status, refunded? }`
- `pause` / `resume` the raw endpoint body, `{ ok, status }`

## Configuration

The CLI stores its login in `~/.config/claimpaign/config.json` (mode 0600).

- `CLAIMPAIGN_API` API base URL, overrides the stored one and the default `https://claimpaign.com`
- `CLAIMPAIGN_TOKEN` sandbox (preprod) API key, overrides the stored one and skips the login prompt
- `CLAIMPAIGN_CONFIG_DIR` directory for `config.json`, default `~/.config/claimpaign`

Setting `CLAIMPAIGN_TOKEN` skips `claimpaign login` entirely, every command reads it before anything else. `claimpaign login` itself always prompts for a key even when the variable is set, its whole purpose is storing a key in the config file.

The key sits in `config.json` in plain text, readable only by your user. To keep it off the disk, store it in a password manager, skip `claimpaign login` and hand the key over through `CLAIMPAIGN_TOKEN` on each call, for example with the 1Password CLI (adjust the reference to your vault):

```
CLAIMPAIGN_TOKEN=$(op read "op://Private/Claimpaign/credential") claimpaign list
```

Or with the macOS Keychain, after storing the key once with `security add-generic-password -s claimpaign -a sandbox -w`, which prompts for it:

```
CLAIMPAIGN_TOKEN=$(security find-generic-password -s claimpaign -a sandbox -w) claimpaign list
```

`claimpaign logout` removes a key that is already stored in the config file.

## Development

From a checkout: `npm install && npm run build`, then `node dist/bin.js --help`, or `npm link` once to get the `claimpaign` command. `npx claimpaign` only works with the published package.

```
npm test
```

`scripts/e2e.sh` runs an end to end test against a real API, not part of `npm test`. It needs `CLAIMPAIGN_API`, `CLAIMPAIGN_TOKEN`, `E2E_ADDRESSES` (a file with one `addr_test` address per line) and `E2E_CAMPAIGN_ID` (an ada campaign with at least one unclaimed code, created in the web interface) as environment variables. The default run is a smoke test, `--full` adds a 60 claim acceptance run and needs `E2E_FULL_CAMPAIGN_ID` (an active unique code campaign with 60 codes and no claims yet), `--foreign` adds a claim against an external CIP-99 faucet and needs `E2E_FOREIGN_URI` (a CIP-99 claim uri, for example the tUSDM preprod faucet). The smoke stage ends `E2E_CAMPAIGN_ID` and `--full` ends `E2E_FULL_CAMPAIGN_ID`, so create fresh campaigns in the web interface before every run.

## Releasing

Releases are published to npm by the release workflow, never from a local machine.

1. Bump the version on a branch with `npm version minor --no-git-tag-version` (or `patch`), open a PR and squash merge it.
2. Tag the merge commit on `main` and push the tag: `git tag -a v0.3.0 -m v0.3.0 && git push origin v0.3.0`.
3. Approve the staged version on npmjs.com under Staged Packages (asks for 2FA). Only then is it installable.

The workflow checks that the tag matches `package.json` and sits on `main`, runs typecheck, tests and build, stages the version on npm with provenance and creates the GitHub release. If the workflow fails after staging, approve the staged version first and then rerun it, it skips npm when that version already came from the same commit.

## License

Apache 2.0
