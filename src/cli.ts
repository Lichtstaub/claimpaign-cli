import { Command, CommanderError } from 'commander';
import { createRequire } from 'node:module';
import { UsageError, CancelledError } from './output.js';
import { login, logout } from './commands/login.js';
import { balance } from './commands/balance.js';
import { deposit } from './commands/deposit.js';
import { campaignCreateMoved, campaignList, campaignStatus, campaignEnd, campaignPause, campaignResume } from './commands/campaign.js';
import { campaignCodes } from './commands/campaign-codes.js';
import { claim } from './commands/claim.js';

const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

export function buildProgram(): Command {
  const program = new Command('claimpaign')
    .description('Claimpaign sandbox campaigns and CIP-99 claims from the terminal')
    .version(version)
    .option('--api <url>', 'API base URL (default https://claimpaign.com, or CLAIMPAIGN_API)')
    .option('--json', 'machine readable output', false)
    .exitOverride(); // errors become exceptions, run() maps them to exit codes

  program
    .command('login')
    .description('Store a sandbox API key')
    .action(async () => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await login({ api: opts.api, json: opts.json });
    });

  program
    .command('logout')
    .description('Remove the stored sandbox API key')
    .action(async () => {
      await logout();
      if (!program.opts<{ json: boolean }>().json) process.stdout.write('Logged out.\n');
    });

  program
    .command('balance')
    .description('Show the sandbox credit balance')
    .action(async () => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await balance({ api: opts.api, json: opts.json });
    });

  program
    .command('deposit')
    .description('Show the organization wallet address and how to add credits')
    .action(async () => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await deposit({ api: opts.api, json: opts.json });
    });

  const campaign = program
    .command('campaign')
    .description('Manage sandbox campaigns');

  campaign
    .command('create')
    .description('Moved to the web interface, prints the link')
    // 0.1.x options and arguments are accepted and ignored, so old scripts get the link instead of a usage error
    .allowUnknownOption()
    .allowExcessArguments()
    .action(() => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      campaignCreateMoved({ api: opts.api, json: opts.json });
    });

  campaign
    .command('list')
    .description('List sandbox campaigns')
    .action(async () => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignList({ api: opts.api, json: opts.json });
    });

  campaign
    .command('status <id>')
    .description('Show a sandbox campaign\'s status, progress and claim queue')
    .action(async (id: string) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignStatus(id, { api: opts.api, json: opts.json });
    });

  campaign
    .command('codes <id>')
    .description('Export a campaign\'s codes as CSV, QR images and/or a print-ready PDF')
    .option('--csv <file>', 'write a CSV file')
    .option('--qr-dir <dir>', 'write one QR PNG per code into this directory')
    .option('--pdf <file>', 'write a print-ready PDF with one card per code')
    .option('--fallback', 'use the HTTPS fallback URL instead of the wallet deep link for QR and PDF', false)
    .option('--all', 'include already claimed codes', false)
    .action(async (id: string, cmdOpts: { csv?: string; qrDir?: string; pdf?: string; fallback: boolean; all: boolean }) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignCodes(id, {
        api: opts.api,
        json: opts.json,
        csv: cmdOpts.csv,
        qrDir: cmdOpts.qrDir,
        pdf: cmdOpts.pdf,
        fallback: cmdOpts.fallback,
        all: cmdOpts.all,
      });
    });

  campaign
    .command('end <id>')
    .description('End a sandbox campaign and refund unclaimed credits')
    .option('--wait', 'keep retrying while payouts are settling', false)
    .action(async (id: string, cmdOpts: { wait: boolean }) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignEnd(id, { api: opts.api, json: opts.json, wait: cmdOpts.wait });
    });

  campaign
    .command('pause <id>')
    .description('Pause a sandbox campaign')
    .action(async (id: string) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignPause(id, { api: opts.api, json: opts.json });
    });

  campaign
    .command('resume <id>')
    .description('Resume a paused sandbox campaign')
    .action(async (id: string) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await campaignResume(id, { api: opts.api, json: opts.json });
    });

  program
    .command('claim <uri-or-code> <address>')
    .description('Claim a CIP-99 code on the Cardano preprod testnet')
    .option('--faucet <url>', 'post a bare code to this faucet url instead of deriving one from --api')
    .action(async (input: string, address: string, cmdOpts: { faucet?: string }) => {
      const opts = program.opts<{ api?: string; json: boolean }>();
      await claim(input, address, { api: opts.api, json: opts.json, faucet: cmdOpts.faucet });
    });

  return program;
}

/** Parse and execute, mapping errors to exit codes: usage 2, runtime and API 1, cancelled prompt 130, help and version 0. */
export async function run(argv: string[]): Promise<number> {
  try {
    await buildProgram().parseAsync(argv);
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version' || err.code === 'commander.help') return 0;
      return 2; // commander already printed its message
    }
    if (err instanceof CancelledError) {
      process.stderr.write('Cancelled\n');
      return 130;
    }
    process.stderr.write(`Error: ${(err as Error)?.message ?? String(err)}\n`);
    return err instanceof UsageError ? 2 : 1;
  }
}
