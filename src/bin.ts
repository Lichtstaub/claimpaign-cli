import { run } from './cli.js';

const exitCode = await run(process.argv);
// Force the exit: once promptSecret() has read from stdin, the stream stays open and
// paused rather than ended (true for both a live TTY and a pipe nobody closed), which
// keeps the event loop alive. process.exitCode alone would leave the process hanging.
process.exit(exitCode);
