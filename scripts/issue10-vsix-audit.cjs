'use strict';
// Issue #10: inspect compiled contents and SHA-256 of the exact VSIX files.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const dir = path.resolve(process.env.ISSUE10_EVIDENCE_DIR || path.join(root, 'issue10-evidence'));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
function inside(vsix, name) {
    const zipEntry = 'extension/' + name;
    if (process.platform === 'win32') {
        // Windows Actions has Python, but not necessarily unzip on PATH.
        const py = 'import sys, zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))';
        return cp.execFileSync('python', ['-c', py, vsix, zipEntry], { maxBuffer: 16 * 1024 * 1024 });
    }
    return cp.execFileSync('unzip', ['-p', vsix, zipEntry], { maxBuffer: 16 * 1024 * 1024 });
}
function inspect(filename, label) {
    if (!fs.existsSync(filename)) return {label, status:'blocked', reason:'VSIX unavailable'};
    const pkg = JSON.parse(inside(filename,'package.json').toString());
    const parser = inside(filename,'out/pathParsing.js').toString();
    const diagnostics = inside(filename,'out/diagnostics.js').toString();
    const inputAllowlist = parser.includes('INPUT_FILE_COMMANDS') &&
        parser.includes('classifyCommandValue') && diagnostics.includes('shouldSkipKeyForFileLookup');
    const inputRoles = parser.includes('CONTROL_FILE_COMMANDS') &&
        parser.includes('DATA_FILE_COMMANDS') && parser.includes('getInputFileRole') &&
        diagnostics.includes('getInputFileRole') && diagnostics.includes('inputRole === null');
    return {
        label, status:'inspected', filename:path.basename(filename),
        bytes:fs.statSync(filename).size, sha256:fileHash(filename),
        id:pkg.publisher + '.' + pkg.name, version:pkg.version,
        vscode:pkg.engines.vscode,
        parserSha256:hash(parser), diagnosticsSha256:hash(diagnostics),
        commandAware:inputAllowlist || inputRoles,
        parserClassifier:inputAllowlist?'input-command-allowlist':inputRoles?'input-file-role':'legacy-heuristic',
        skipsUnknownCommands:inputAllowlist && parser.includes("!== 'input-file'") || inputRoles,
        diagnosticsUsesSkipGate:diagnostics.includes('shouldSkipKeyForFileLookup') ||
            diagnostics.includes('inputRole === null'),
        stableCodes:diagnostics.includes('TPV_CODES')
    };
}
const [current,old] = process.argv.slice(2);
if (!current || !old) throw new Error('Usage: node scripts/issue10-vsix-audit.cjs current.vsix published.vsix');
const main = inspect(current,'source-built');
const release = inspect(old,'GitHub-release-v0.2.6');
const compiled = process.env.ISSUE10_COMPILED_PARSER || path.join(root,'out','pathParsing.js');
const result = {
    recordedAt:new Date().toISOString(),
    buildCommit:process.env.INTEGRATED_AB_SHA || process.env.GITHUB_SHA || null,
    validatorBase:process.env.VALIDATOR_BASE_SHA || null,
    helper12:process.env.HELPER12_SHA || null,
    helper16:process.env.HELPER16_SHA || null,
    current:main, published:release,
    compiledSourceParserSha256:fs.existsSync(compiled)?fileHash(compiled):null
};
result.currentMatchesCompiled = main.parserSha256 === result.compiledSourceParserSha256;
result.currentCorrected = main.commandAware && main.skipsUnknownCommands &&
    main.diagnosticsUsesSkipGate && main.stableCodes;
result.releaseLegacy = release.status==='inspected' && !release.commandAware && release.diagnosticsUsesSkipGate;
result.sameVersionDifferentParser = main.version===release.version && main.parserSha256!==release.parserSha256;
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'vsix-audit.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (!result.currentMatchesCompiled || !result.currentCorrected) process.exitCode=1;
