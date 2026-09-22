import { apiRequest, requireToken } from '../api.js';
import { resolveApi } from '../config.js';
import { print } from '../output.js';

interface WalletBody {
  network: string;
  address: string;
  ada: { lovelace: string; ada: number };
  tokens: unknown[];
}

/** Fetches the org wallet and prints its address together with deposit instructions. */
export async function deposit(opts: { api?: string; json: boolean }): Promise<void> {
  const token = requireToken();
  const api = resolveApi(opts.api);

  const { body: wallet } = await apiRequest<WalletBody>({ api, token, method: 'GET', path: '/api/org/wallet' });

  if (opts.json) {
    print({ address: wallet.address, network: wallet.network }, { json: true });
    return;
  }

  const lines = [
    `Org wallet: ${wallet.address}`,
    '',
    'Send test tokens to this address. They stay the property of the organization and get distributed from there.',
    'Any tADA sent along with them is used for payouts, it does not become sandbox credits.',
    `Top up tADA credits in the web interface at ${api}/admin/create/.`,
    'Preprod ada for the wallet itself comes from the Cardano testnet faucet: https://docs.cardano.org/cardano-testnets/tools/faucet',
  ];
  print(lines.join('\n'), { json: false });
}
