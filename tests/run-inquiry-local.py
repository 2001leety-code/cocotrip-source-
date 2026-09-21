"""Run inquiry integration tests against an already-running local demo emulator."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ALLOWED_ENV = (
    'PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'PROGRAMDATA', 'SYSTEMDRIVE',
)

env = {key: os.environ[key] for key in ALLOWED_ENV if os.environ.get(key)}
env.update({
    'FIRESTORE_EMULATOR_HOST': '127.0.0.1:18089',
    'GCLOUD_PROJECT': 'demo-cocotrip-inquiry',
    'PRERENDER': '0',
    'NODE_OPTIONS': f'--require="{(ROOT / "tests/helpers/offline-network.cjs").as_posix()}"',
    'npm_config_offline': 'true',
    'npm_config_audit': 'false',
    'npm_config_fund': 'false',
    'npm_config_update_notifier': 'false',
})

# Fail before importing product code if external sockets are not blocked.
guard_check = """
const assert = require('node:assert/strict');
const net = require('node:net');
for (const host of ['firestore.googleapis.com', 'api.telegram.org', '1.1.1.1']) {
  assert.throws(() => net.connect({host, port: 443}), {code: 'OFFLINE_NETWORK_BLOCKED'});
}
assert.throws(() => require('node:tls').connect({host: 'api.telegram.org', port: 443}), {code: 'OFFLINE_NETWORK_BLOCKED'});
assert.throws(() => require('node:dns').lookup('firestore.googleapis.com', () => {}), {code: 'OFFLINE_NETWORK_BLOCKED'});
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18089');
assert.equal(process.env.GCLOUD_PROJECT, 'demo-cocotrip-inquiry');
assert.equal(Object.keys(process.env).some(key => /FIREBASE|PRIVATE_KEY|CREDENTIAL|TOKEN|SECRET|API_KEY/.test(key)), false);
console.log('Isolation PASS: demo emulator only; external sockets blocked; credential variables absent');
"""
checked = subprocess.run(['node', '-e', guard_check], cwd=ROOT, env=env, check=False)
if checked.returncode:
    sys.exit(checked.returncode)

if sys.argv[1:] == ['--check-isolation']:
    sys.exit(0)
if sys.argv[1:]:
    sys.exit('usage: python tests/run-inquiry-local.py [--check-isolation]')

command = [
    'npm.cmd' if os.name == 'nt' else 'npm', 'run', 'test:unit', '--',
    '--config', 'tests/vitest-inquiry-local.config.ts',
]
sys.exit(subprocess.run(command, cwd=ROOT, env=env, check=False).returncode)
