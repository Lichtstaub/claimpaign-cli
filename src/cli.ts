import { Command, CommanderError } from 'commander';
import { createRequire } from 'node:module';
import { UsageError, CancelledError } from './output.js';
import { login, logout } from './commands/login.js';

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
    .action(() => {
      throw new Error('not implemented yet');
    });

  program
    .command('deposit')
    .description('Add sandbox credits to the organization')
    .action(() => {
      throw new Error('not implemented yet');
    });

  program
    .command('campaign')
    .description('Manage sandbox campaigns')
    .action(() => {
      throw new Error('not implemented yet');
    });

  program
    .command('claim')
    .description('Claim a CIP-99 sandbox code')
    .action(() => {
      throw new Error('not implemented yet');
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
