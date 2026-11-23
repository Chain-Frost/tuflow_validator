import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
    console.log(`Actual VS Code integration host: ${vscode.version}; Node ${process.versions.node}`);
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname);
    const files = glob.sync('**/*.test.js', { cwd: testsRoot });

    for (const file of files) {
        mocha.addFile(path.resolve(testsRoot, file));
    }

    await new Promise<void>((resolve, reject) => {
        mocha.run(failures => {
            if (failures > 0) {
                reject(new Error(`${failures} tests failed.`));
            } else {
                resolve();
            }
        });
    });
}
