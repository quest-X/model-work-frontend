const assert = require('node:assert/strict');
const {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {resolveConfig} = require('vite');

const source = resolve(__dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'opensight-vite-cache-'));

(async () => {
    try {
        const caches = [];
        for (const name of ['main', 'commercial']) {
            const root = join(temporary, name);
            mkdirSync(root);
            for (const entry of ['node_modules', 'package.json']) {
                symlinkSync(join(source, entry), join(root, entry));
            }
            const config = await resolveConfig({
                configFile: join(source, 'vite.config.ts'),
                root,
            }, 'serve');
            mkdirSync(config.cacheDir, {recursive: true});
            caches.push(realpathSync(config.cacheDir));
        }
        assert.notEqual(caches[0], caches[1], 'Worktrees must not share Vite dependency caches');
        console.log('PASS: shared node_modules keeps independent Vite caches');
    } finally {
        rmSync(temporary, {recursive: true, force: true});
    }
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
