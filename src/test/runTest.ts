import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

let dbusProcess: ChildProcess | null = null;

process.on('exit', () => {
    if (dbusProcess) {
        dbusProcess.kill();
        dbusProcess = null;
    }
});

async function main(): Promise<void> {
    let dbusAddress: string | undefined;
    let vscodeExecutablePath: string | undefined;
    try {
        // Remote/container setups often force Electron to start as Node.
        delete process.env.ELECTRON_RUN_AS_NODE;
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        dbusAddress = await startDbusDaemon();
        const dbusEnv = dbusAddress ?? 'unix:path=/dev/null';
        if (dbusAddress) {
            process.env.DBUS_SESSION_BUS_ADDRESS = dbusAddress;
            process.env.DBUS_SYSTEM_BUS_ADDRESS = dbusAddress;
        }

        const downloadOptions = { extensionDevelopmentPath };
        vscodeExecutablePath = await downloadAndUnzipVSCode(downloadOptions);
        await patchNativeKeymap(vscodeExecutablePath);

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-sandbox'
            ],
            extensionTestsEnv: {
                DBUS_SESSION_BUS_ADDRESS: dbusEnv,
                DBUS_SYSTEM_BUS_ADDRESS: dbusEnv
            },
            vscodeExecutablePath
        });
    } catch (error) {
        console.error('Failed to run tests.');
        console.error(error);
        process.exit(1);
    } finally {
        if (dbusProcess) {
            dbusProcess.kill();
            dbusProcess = null;
        }
    }
}

main();

async function startDbusDaemon(): Promise<string | undefined> {
    if (process.platform !== 'linux') {
        return undefined;
    }

    return new Promise(resolve => {
        const daemon = spawn('dbus-daemon', ['--session', '--print-address', '--nopidfile'], {
            stdio: ['ignore', 'pipe', 'ignore']
        });
        let resolved = false;

        const timer = setTimeout(() => {
            if (!resolved) {
                cleanup();
                resolve(undefined);
            }
        }, 3000);

        const cleanup = () => {
            clearTimeout(timer);
            daemon.stdout?.off('data', onData);
        };

        const onData = (chunk: Buffer) => {
            const text = chunk.toString();
            const newlineIndex = text.indexOf('\n');
            if (newlineIndex >= 0) {
                const address = text.slice(0, newlineIndex).trim();
                if (!address) {
                    return;
                }
                resolved = true;
                cleanup();
                dbusProcess = daemon;
                resolve(address);
            }
        };

        daemon.stdout?.on('data', onData);

        daemon.on('error', () => {
            if (!resolved) {
                cleanup();
                resolve(undefined);
            }
        });

        daemon.on('exit', () => {
            if (!resolved) {
                cleanup();
                resolve(undefined);
            }
        });

        setTimeout(() => {
            if (!resolved) {
                cleanup();
                resolve(undefined);
            }
        }, 3000);
    });
}

const nativeKeymapStub = `module.exports = {
    getKeyMap() { return []; },
    getCurrentKeyboardLayout() { return null; },
    onDidChangeKeyboardLayout() {},
    isISOKeyboard() { return false; }
};
`;

async function patchNativeKeymap(vscodeExecutablePath: string): Promise<void> {
    const nativeKeymapDir = path.join(path.dirname(vscodeExecutablePath), 'resources', 'app', 'node_modules', 'native-keymap');
    try {
        await fs.promises.access(nativeKeymapDir);
    } catch {
        return;
    }

    for (const variant of ['Release', 'Debug']) {
        const variantDir = path.join(nativeKeymapDir, 'build', variant);
        try {
            await fs.promises.mkdir(variantDir, { recursive: true });
            const nodeBinding = path.join(variantDir, 'keymapping.node');
            const jsBinding = path.join(variantDir, 'keymapping.js');
            if ((await fileExists(nodeBinding)) || (await fileExists(jsBinding))) {
                continue;
            }
            await fs.promises.writeFile(jsBinding, nativeKeymapStub, 'utf8');
        } catch {
            // best effort; leave logging to VS Code if stub cannot be written
        }
    }
}

async function fileExists(target: string): Promise<boolean> {
    try {
        await fs.promises.access(target);
        return true;
    } catch {
        return false;
    }
}
