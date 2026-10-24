import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

function cli(args) {
  const result = spawnSync(process.env.ComSpec, ['/d', '/s', '/c', `npx.cmd --yes --package @playwright/cli playwright-cli -s=mobile-fluidity ${args}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || result.stdout.slice(0, 1000));
  return result.stdout;
}
await mkdir('output/playwright', { recursive: true });
const mode = process.argv.includes('--appearance') ? 'appearance' : process.argv.includes('--safe-area') ? 'safe-area' : process.argv.includes('--friends') ? 'friends' : process.argv.includes('--avatar') ? 'avatar' : process.argv.includes('--profile') ? 'profile' : process.argv.includes('--flash') ? 'flash' : process.argv.includes('--cache') ? 'cache' : process.argv.includes('--lifetime') ? 'lifetime' : process.argv.includes('--measure') ? 'measure' : process.argv.includes('--extended') ? 'extended' : 'basic';
const script = { basic: 'check-fluidity', extended: 'check-fluidity-extended', measure: 'measure-fluidity', lifetime: 'check-cache-lifetime', cache: 'measure-cache', flash: 'check-transition-flash', profile: 'check-profile', friends: 'check-friends', avatar: 'check-custom-avatar', 'safe-area': 'check-safe-area', appearance: 'check-appearance' }[mode];
const raw = cli(`run-code --filename scripts/${script}.cjs`);
if (!raw.startsWith('### Result')) throw Error(raw.slice(0, 1500));
const result = JSON.parse(JSON.parse(raw.split(/\r?\n/)[1]));
await writeFile(`output/playwright/fluidity-${mode}.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
