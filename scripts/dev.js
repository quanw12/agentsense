// Starts Electron with devtools enabled. Works on Windows without a Unix env prefix.
const { spawn } = require('child_process');
const electron = require('electron');

const env = Object.assign({}, process.env, { AGENT_HUB_DEVTOOLS: '1' });
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: false });
child.on('exit', (code) => process.exit(code == null ? 1 : code));
