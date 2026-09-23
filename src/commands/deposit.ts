import { resolveApi, webCreateUrl } from '../config.js';
import { print } from '../output.js';

const FAUCET_URL = 'https://docs.cardano.org/cardano-testnets/tools/faucet';

/** Explains how sandbox credits are added. Sends no request and needs no login. */
export function deposit(opts: { api?: string; json: boolean }): void {
  const api = resolveApi(opts.api);
  const topupUrl = webCreateUrl(api);

  if (opts.json) {
    print({ topupUrl, faucetUrl: FAUCET_URL }, { json: true });
    return;
  }

  print([
    `Add sandbox (preprod) credits in the web interface: ${topupUrl}`,
    'Credits are added once the top up transaction is confirmed, usually within a few minutes.',
    `Test ada for the top up comes from the Cardano testnet faucet: ${FAUCET_URL}`,
    'Test tokens such as tUSDM come from the platform and are paid with credits when you create a campaign.',
  ].join('\n'), { json: false });
}
