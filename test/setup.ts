import { execFileSync } from 'node:child_process';

export function setup(): void {
  execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
}
