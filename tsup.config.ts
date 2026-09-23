import { defineConfig } from 'tsup';

// Packages outside "dependencies" get bundled. pdf-lib is a devDependency on purpose:
// its tarball ships a minified browser build that supply chain scanners flag as obfuscated.
export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
});
