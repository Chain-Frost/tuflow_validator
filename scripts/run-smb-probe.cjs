const fs = require('fs'), path = require('path');
const {runTests} = require('../node_modules/@vscode/test-electron');
const base = process.env.TPV_LAB_ROOT || 'E:/temp/tpv-smb-investigation-20261123';
// Explicit disposable locations; never infer a production path from an editor.
const locations = JSON.parse(fs.readFileSync(path.join(base, 'locations-private.json'), 'utf8').replace(/^\uFEFF/, ''));
delete process.env.ELECTRON_RUN_AS_NODE;
(async () => {
 for (const storage of ['local', 'unc', 'mapped']) for (const workspace of (process.env.TPV_DEPTH || process.env.TPV_REPEAT ? [false] : process.env.TPV_FULL || process.env.TPV_LIFECYCLE ? [true] : [false, true])) {
  const label = storage + (process.env.TPV_REPEAT ? '-repeat-empty' : process.env.TPV_DEPTH ? '-depth' : process.env.TPV_LIFECYCLE ? '-lifecycle' : process.env.TPV_FULL ? '-acceptance' : workspace ? '-workspace' : '-empty');
  await runTests({vscodeExecutablePath: 'C:/Program Files/Microsoft VS Code/Code.exe', extensionDevelopmentPath: base + '/probe', extensionTestsPath: path.join(__dirname, process.env.TPV_DEPTH ? 'smb-depth-probe.cjs' : process.env.TPV_LIFECYCLE ? 'smb-lifecycle-probe.cjs' : process.env.TPV_FULL ? 'smb-workspace-acceptance.cjs' : 'smb-watch-probe.cjs'),
   launchArgs: [...(workspace ? [locations[storage]] : []), '--user-data-dir', base + '/profiles/' + label, '--extensions-dir', base + '/installed', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--log', 'trace'],
   extensionTestsEnv: {TPV_MUTATION_NODE: process.execPath, TPV_SIMPLE_ONLY: process.env.TPV_REPEAT ? '1' : '', TPV_PARENT: locations[storage], TPV_OUTPUT: base + '/' + label + '.json', TPV_HOST_PARENT: locations[storage], TPV_STORAGE_LABEL: storage, TPV_HOST_OUTPUT: base + '/' + label + '.json'}});
 }
})().catch(e => {console.error(e); process.exitCode = 1;});
