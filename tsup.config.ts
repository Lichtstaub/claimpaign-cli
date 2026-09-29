import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Options } from 'tsup';

type EsbuildPlugin = NonNullable<Options['esbuildPlugins']>[number];

// Bundled code keeps its license terms, so every package that ends up in the bundle
// gets its license text copied into dist/THIRD_PARTY_LICENSES.txt.
const thirdPartyLicenses: EsbuildPlugin = {
  name: 'third-party-licenses',
  setup(build) {
    build.initialOptions.metafile = true;
    build.onEnd(result => {
      if (!result.metafile) return;
      const packageDirs = new Set<string>();
      for (const input of Object.keys(result.metafile.inputs)) {
        // the last node_modules segment is the package the file belongs to, even when nested
        const match = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
        if (match) packageDirs.add(match[1]);
      }
      const sections = [...packageDirs].sort().map(dir => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
        const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)/i.test(f));
        if (!file) throw new Error(`${pkg.name} is bundled but ships no license file`);
        return `${pkg.name}@${pkg.version}\nLicense: ${pkg.license ?? 'see below'}\n\n${readFileSync(join(dir, file), 'utf8').trim()}\n`;
      });
      // onEnd runs before tsup writes the bundle, so on a fresh checkout the folder does not exist yet
      const outdir = build.initialOptions.outdir ?? 'dist';
      mkdirSync(outdir, { recursive: true });
      writeFileSync(join(outdir, 'THIRD_PARTY_LICENSES.txt'), sections.join(`\n${'-'.repeat(72)}\n\n`));
    });
  },
};

// Packages outside "dependencies" get bundled. pdf-lib is a devDependency on purpose:
// its tarball ships a minified browser build that supply chain scanners flag as obfuscated.
// qrcode is one too, so its CLI-only yargs tree (two dozen old packages) never gets installed.
// qrcode is CommonJS and requires Node built-ins, which an ESM bundle only resolves
// through a real require, hence the createRequire banner.
export default defineConfig({
  entry: ['src/bin.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  esbuildPlugins: [thirdPartyLicenses],
});
