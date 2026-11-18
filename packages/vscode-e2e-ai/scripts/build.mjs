// Bundles the extension (esbuild, `vscode` external) and, with --vsix, writes a .vsix package
// (a zip with extension.vsixmanifest + [Content_Types].xml + extension/...), installable with
// `code --install-extension dist/e2e-ai-vscode-<version>.vsix`.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

await build({
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  outfile: join(root, 'dist/extension.js'),
  sourcemap: true,
  logLevel: 'warning',
});
console.log('built dist/extension.js');

if (process.argv.includes('--vsix')) {
  const stage = join(root, 'dist/.vsix');
  rmSync(stage, { recursive: true, force: true });
  const ext = join(stage, 'extension');
  mkdirSync(join(ext, 'dist'), { recursive: true });
  const manifest = { ...pkg };
  delete manifest.devDependencies;
  delete manifest.scripts;
  writeFileSync(join(ext, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const f of ['dist/extension.js', 'language-configuration.json', 'README.md']) cpSync(join(root, f), join(ext, f));
  for (const d of ['syntaxes', 'snippets']) cpSync(join(root, d), join(ext, d), { recursive: true });
  writeFileSync(
    join(stage, '[Content_Types].xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/><Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".md" ContentType="text/markdown"/><Default Extension=".code-snippets" ContentType="application/json"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>`,
  );
  writeFileSync(
    join(stage, 'extension.vsixmanifest'),
    `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"/>
    <DisplayName>${pkg.displayName}</DisplayName>
    <Description xml:space="preserve">${pkg.description}</Description>
    <Categories>${pkg.categories.join(',')}</Categories>
    <Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}"/></Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
  </Assets>
</PackageManifest>`,
  );
  const out = join(root, `dist/${pkg.name}-${pkg.version}.vsix`);
  rmSync(out, { force: true });
  execFileSync('zip', ['-qr', '-X', out, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'], { cwd: stage });
  console.log(`packaged ${out}`);
}
