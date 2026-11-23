const path = require('path');
const {runTests} = require('../node_modules/@vscode/test-electron');
delete process.env.ELECTRON_RUN_AS_NODE;
runTests({vscodeExecutablePath: 'C:/Program Files/Microsoft VS Code/Code.exe', extensionDevelopmentPath: path.resolve(__dirname, '..'), extensionTestsPath: path.resolve(__dirname, '../out/test/suite/index.js'), launchArgs: ['--user-data-dir', 'E:/temp/tpv-smb-investigation-20261123/suite-profile', '--extensions-dir', 'E:/temp/tpv-smb-investigation-20261123/suite-extensions', '--disable-workspace-trust', '--disable-gpu', '--skip-welcome']}).catch(e => {console.error(e); process.exitCode=1;});
