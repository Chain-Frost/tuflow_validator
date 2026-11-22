'use strict';
// Artifact-specific Extension Host checks, reusing the runner in Helper PR #16.
// The runner is copied and instrumented in a temporary directory; no Helper sources are modified.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
    runTests
} = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const evidence = path.resolve(process.env.ISSUE10_EVIDENCE_DIR || path.join(root, 'issue10-evidence'));
const probes = {
    'model.tcf': [
        'Viscosity Formulation == SMAGORINSKY',
        'Viscosity Coefficients == 0.2, 0.1',
        'Start Time == 0.05',
        'Time Step == 0.1',
        'Unknown Experimental Command == value.2026',
        'Geometry Control File == issue10_missing.tgc',
        'If Scenario == issue10_format_probe',
        'Read File == issue10_conditional_missing.trd',
        'End If ! issue10 format probe'
    ],
    'geometry.tgc': [
        'Read GIS Z Shape == gis/issue10_missing_a.shp | gis/issue10_missing_b.shp'
    ]
};
const negativeLines = probes['model.tcf'].slice(0, 5);
const inputLines = [
    {file:'model.tcf',line:probes['model.tcf'][5]},
    {file:'model.tcf',line:probes['model.tcf'][7]},
    {file:'geometry.tgc',line:probes['geometry.tgc'][0]}
];
const expectedMissing = [
    'issue10_missing.tgc', 'issue10_conditional_missing.trd',
    'gis/issue10_missing_a.shp', 'gis/issue10_missing_b.shp'
];
const hashFile = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function save(name, data) {
    fs.mkdirSync(evidence, {recursive:true});
    fs.writeFileSync(path.join(evidence,name), JSON.stringify(data,null,2)+'\n');
}
function addFixtureLines(acceptancePath) {
    const dir = path.join(evidence,'helper16-copy');
    fs.cpSync(path.join(acceptancePath,'test','acceptance'),dir,{recursive:true});
    const locations = {};
    for (const [file,values] of Object.entries(probes)) {
        const fileName = path.join(dir,'fixtures',file);
        const original = fs.readFileSync(fileName,'utf8').trimEnd();
        fs.writeFileSync(fileName,original+'\n'+values.join('\n')+'\n');
        const lines = fs.readFileSync(fileName,'utf8').split(/\r?\n/);
        for (const line of values) {
            const found = lines.flatMap((text,i) => text === line ? [i+1] : []);
            if (found.length !== 1) throw new Error('Probe line is not unique in '+file+': '+line);
            locations[file+'|'+line] = found[0];
        }
    }

    const runner = path.join(dir,'vscode-runner.cjs');
    let source = fs.readFileSync(runner,'utf8');
    function inject(marker, addition) {
        if (!source.includes(marker)) throw new Error('Helper PR #16 runner marker changed: '+marker);
        source = source.replace(marker, marker+'\n'+addition.join('\n'));
    }
    inject('const docs = {};', [
        '  report.issue10Startup = {',
        '    openDocuments: vscode.workspace.textDocuments.map(d => ({ file: d.fileName, languageId: d.languageId })),',
        '    activeEditor: vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName,',
        "    associations: vscode.workspace.getConfiguration('files').get('associations', {})",
        '  };'
    ]);
    inject('source: diag.source || null,', [
        "          code: diag.code && typeof diag.code === 'object' ? diag.code.value : (diag.code || null),"
    ]);
    inject('report.diagnostics = problems;', [
        "    const probeDoc = docs['model.tcf'];",
        '    const allProbeDiagnostics = vscode.languages.getDiagnostics(probeDoc.uri);',
        "    const missingProbe = allProbeDiagnostics.find(d => d.message.includes('issue10_missing.tgc'));",
        '    const fixes = missingProbe ? await vscode.commands.executeCommand(',
        "      'vscode.executeCodeActionProvider', probeDoc.uri, missingProbe.range,",
        '      vscode.CodeActionKind.QuickFix.value) : [];',
        '    const formatOptions = { tabSize: 4, insertSpaces: true };',
        '    const formatBefore = await vscode.commands.executeCommand(',
        "      'vscode.executeFormatDocumentProvider', probeDoc.uri, formatOptions);",
        "    const validatorConfig = vscode.workspace.getConfiguration('tuflowValidator');",
        "    const formattingInitiallyEnabled = validatorConfig.get('enableIfStatementFormatting',false);",
        '    let formatEnabledCount = null;',
        '    if (report.extensions.validator) {',
        "      await validatorConfig.update('enableIfStatementFormatting',true,vscode.ConfigurationTarget.Global);",
        '      const formatEnabled = await vscode.commands.executeCommand(',
        "        'vscode.executeFormatDocumentProvider', probeDoc.uri, formatOptions);",
        '      formatEnabledCount = Array.isArray(formatEnabled) ? formatEnabled.length : null;',
        "      await validatorConfig.update('enableIfStatementFormatting',false,vscode.ConfigurationTarget.Global);",
        '    }',
        '    report.issue10Options = {',
        '      quickFixTitles:(fixes||[]).map(action=>action.title),',
        '      formattedInitially:formattingInitiallyEnabled,',
        '      defaultFormatEditCount:Array.isArray(formatBefore)?formatBefore.length:null,',
        '      enabledFormatEditCount:formatEnabledCount',
        '    };'
    ]);
    inject("check('theme-and-ui-checks', 'unverified', { manualChecks: report.manualChecks });", [
        "    const rootUri = docs['model.tcf'].uri;",
        "    const beforeClose = vscode.languages.getDiagnostics(rootUri).filter(d=>d.message.includes('issue10_missing.tgc'));",
        "    await vscode.commands.executeCommand('workbench.action.closeAllEditors');",
        '    const reopened = await vscode.workspace.openTextDocument(rootUri);',
        '    await vscode.window.showTextDocument(reopened,{preview:false});',
        '    await pause(900);',
        "    const afterOpen = vscode.languages.getDiagnostics(reopened.uri).filter(d=>d.message.includes('issue10_missing.tgc'));",
        '    report.issue10Reopen = { languageId:reopened.languageId, before:beforeClose.length, after:afterOpen.length };'
    ]);
    fs.writeFileSync(runner,source);
    save('fixture-provenance.json',{
        originRunnerSha256:hashFile(path.join(acceptancePath,'test','acceptance','vscode-runner.cjs')),
        instrumentedRunnerSha256:hashFile(runner),
        origin:'Helper PR #16 acceptance runner (temporary diagnostics-code/Quick Fix/format/reopen instrumentation)',
        lines:locations, fixtures:probes
    });
    return {runner,fixtures:path.join(dir,'fixtures'),locations};
}
function check(report,entry,locations) {
    if (!report) return {name:entry.name,status:'blocked',reason:'No Extension Host report'};
    const lineDiagnostics = (file,line) => (report.diagnostics || []).filter(x =>
        x.file===file && x.line===locations[file+'|'+line]);
    const missing = (file,line) => lineDiagnostics(file,line).filter(d =>
        d.message.startsWith('File not found:'));
    const unexpected = Object.fromEntries(negativeLines.map(line => [line,missing('model.tcf',line)]));
    const noFalseMissing = Object.values(unexpected).every(items=>items.length===0);
    const positives = Object.fromEntries(expectedMissing.map(name=>{
        const match = inputLines.flatMap(({file,line})=>missing(file,line))
            .filter(d=>d.message==='File not found: '+name);
        const source = inputLines.find(({line})=>line.includes(name));
        if (!source) throw new Error('No issue 10 source line for missing path: '+name);
        const first = source.line.indexOf(name);
        return [name,{
            count:match.length, rangeCorrect:match.length===1 &&
                match[0].line===locations[source.file+'|'+source.line] &&
                match[0].start===first && match[0].end===first+name.length,
            code:match.map(d=>d.code), source:match.map(d=>d.source)
        }];
    }));
    const isOld = entry.origin==='published';
    const missingPass = Object.values(positives).every(p=>p.count===1 && p.rangeCorrect &&
        (isOld || (p.code[0]==='TPV001' && p.source[0]==='TUFLOW Path Validator')));
    const unknownPass = missing('model.tcf',negativeLines[4]).length===0;
    const actionTitles = report.issue10Options?.quickFixTitles || [];
    const actionPass = actionTitles.includes('Ignore this line (TUFLOW)') &&
        actionTitles.includes('Ignore entire file (TUFLOW)');
    const formattingPass = report.issue10Options &&
        report.issue10Options.formattedInitially === false &&
        report.issue10Options.enabledFormatEditCount > 0;
    const hasValidator = entry.role!=='helper-only';
    const languagePass = report.metrics?.documentOpen?.['model.tcf']?.languageId==='tuflow';
    const after = report.issue10Reopen;
    const reopenPass = after && after.languageId==='tuflow' && after.before===after.after && after.after>0;
    const historicalFalsePositive = missing('model.tcf',negativeLines[1]).length>0;
    let status;
    if (!hasValidator) status = !report.diagnostics.length && languagePass ? 'passed':'failed';
    else if (isOld) status = historicalFalsePositive && missingPass && languagePass ? 'passed-negative-control':'failed-negative-control';
    else status = noFalseMissing && unknownPass && missingPass && actionPass &&
        languagePass && reopenPass && formattingPass ? 'passed':'failed';
    return {
        name:entry.name,role:entry.role,origin:entry.origin,status,
        hostEvidence:true, vscode:report.environment?.vscodeVersion,
        extensionHostPid:report.environment?.extensionHostPid,
        installed:report.extensions, startup:report.issue10Startup,
        settings:entry.settings, language:report.metrics?.documentOpen?.['model.tcf']?.languageId,
        noFalseMissing, unexpectedMissing:unexpected, unknownPass,
        missingPass,missingEvidence:positives,quickFixPass:actionPass,
        formattingPass:hasValidator?Boolean(formattingPass):null,
        quickFixTitles:actionTitles, format:report.issue10Options,
        reopen:after, historicalFalsePositive:isOld?historicalFalsePositive:null,
        companionRunnerFailChecks:report.checks?.filter(x=>x.status==='fail').map(x=>x.id),
        companionRunnerSummary:report.summary
    };
}
async function main() {
    const [current,old,helper,acceptance] = process.argv.slice(2).map(p=>path.resolve(p));
    if (!current || !old || !helper || !acceptance) {
        throw new Error('Usage: node scripts/issue10-host.cjs current.vsix release.vsix helper12.vsix helper16-checkout');
    }
    fs.mkdirSync(evidence,{recursive:true});
    const helperRunner = addFixtureLines(acceptance);
    const driver = path.join(evidence,'test-driver');
    fs.mkdirSync(driver,{recursive:true});
    fs.writeFileSync(path.join(driver,'package.json'),JSON.stringify({
        name:'tuflow-issue10-test-driver',publisher:'local-test',version:'0.0.0',
        engines:{vscode:'^1.74.0'},main:'./extension.js'
    }));
    fs.writeFileSync(path.join(driver,'extension.js'),'exports.activate = () => {};\n');
    const executable = await downloadAndUnzipVSCode();
    const [cli,...cliPrefix] = resolveCliArgsFromVSCodeExecutablePath(executable,{reuseMachineInstall:true});
    const entries = [
        {name:'validator-only-main',role:'validator-only',vsix:current,origin:'main'},
        {name:'validator-only-published',role:'validator-only',vsix:old,origin:'published'},
        {name:'helper-only',role:'helper-only',helper:true,origin:'main'},
        {name:'both',role:'combined',helper:true,vsix:current,origin:'main'},
        {name:'both-associations',role:'combined',helper:true,vsix:current,origin:'main',associations:true},
        {name:'both-plus-seito-errorlens',role:'full',helper:true,vsix:current,origin:'main',thirdParty:true}
    ];
    const summary = {date:new Date().toISOString(),platform:process.platform,node:process.version,
        vscodeExecutable:executable,
        sha:{current:hashFile(current),published:fs.existsSync(old)?hashFile(old):null,helper:hashFile(helper)},
        sourceSha:process.env.INTEGRATED_AB_SHA||process.env.GITHUB_SHA||null,baseSha:process.env.VALIDATOR_BASE_SHA||null,
        helper12Sha:process.env.HELPER12_SHA||null,helper16Sha:process.env.HELPER16_SHA||null,
        results:[]};
    for (const entry of entries) {
        const base = path.join(evidence,'profiles',entry.name);
        const user = path.join(base,'user');
        const extensions = path.join(base,'extensions');
        fs.mkdirSync(path.join(user,'User'),{recursive:true});
        fs.mkdirSync(extensions,{recursive:true});
        const settings = {
            'tuflowValidator.diagnosticLevel':'hint',
            'tuflowValidator.enableLatestVersionChecks':true,
            'tuflowValidator.enableIfStatementChecks':true,
            'tuflowValidator.enableIfStatementFormatting':false
        };
        if (entry.associations) settings['files.associations'] = {
            '*.tcf':'tuflow','*.tgc':'tuflow','*.tbc':'tuflow','*.ecf':'tuflow',
            '*.trd':'tuflow','*.tef':'tuflow','*.qcf':'tuflow'
        };
        entry.settings = settings;
        fs.writeFileSync(path.join(user,'User','settings.json'),JSON.stringify(settings,null,2));
        const install = [
            ...(entry.vsix?[entry.vsix]:[]),
            ...(entry.helper?[helper]:[]),
            ...(entry.thirdParty?['Fr43nk.seito-openfile','usernamehw.errorlens']:[])
        ];
        let blocker = null;
        for (const item of install) {
            if (item.endsWith('.vsix') && !fs.existsSync(item)) {
                blocker = 'Unobtainable VSIX: '+item;
                break;
            }
            const run = cp.spawnSync(cli,[...cliPrefix,'--user-data-dir',user,
                '--extensions-dir',extensions,'--install-extension',item,'--force'],{
                encoding:'utf8',timeout:180000,env:{...process.env,ELECTRON_RUN_AS_NODE:''}
            });
            console.log('[install '+entry.name+'] '+item+' exit='+run.status+'\n'+
                ((run.stdout||'')+'\n'+(run.stderr||'')).slice(-1200));
            if (run.status!==0) {
                blocker = 'Install failed: '+item+'; '+(run.stderr||run.error||run.stdout);
                break;
            }
        }
        if (blocker) {
            const result = {name:entry.name,role:entry.role,status:'blocked',reason:String(blocker)};
            summary.results.push(result);save('result-'+entry.name+'.json',result);
            continue;
        }
        const output = path.join(evidence,'host-'+entry.name+'.json');
        let runnerError = null;
        try {
            await runTests({
                vscodeExecutablePath:executable,
                extensionDevelopmentPath:driver,
                extensionTestsPath:helperRunner.runner,
                reuseMachineInstall:true,
                launchArgs:[helperRunner.fixtures,
                    path.join(helperRunner.fixtures,'model.tcf'),
                    '--user-data-dir',user,'--extensions-dir',extensions,
                    '--disable-gpu','--no-sandbox'],
                extensionTestsEnv:{
                    TUFLOW_ACCEPT_PROFILE:entry.role,
                    TUFLOW_ACCEPT_PHASE:'issue10-packaged',
                    TUFLOW_ACCEPT_REVISION:process.env.GITHUB_SHA||'unrecorded',
                    TUFLOW_ACCEPT_OUTPUT:output,
                    TUFLOW_ACCEPT_REPEATS:'3',
                    TUFLOW_ACCEPT_LINES:'1000',
                    TUFLOW_ACCEPT_SETTLE_MS:'1500'
                }
            });
        } catch(err) {
            runnerError=String(err);
            console.log('[host '+entry.name+'] '+runnerError);
        }
        const report = fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null;
        const result = check(report,entry,helperRunner.locations);
        result.artifactSha256 = entry.vsix?hashFile(entry.vsix):null;
        result.helperVsixSha256 = entry.helper?hashFile(helper):null;
        result.runnerError = runnerError;
        summary.results.push(result);
        save('result-'+entry.name+'.json',result);
    }
    save('host-summary.json',summary);
    console.log(JSON.stringify(summary.results.map(r=>({
        name:r.name,status:r.status,vscode:r.vscode,
        falseMissingAbsent:r.noFalseMissing,genuineMissing:r.missingPass,
        quickFix:r.quickFixPass,helperChecksFailing:r.companionRunnerFailChecks
    })),null,2));
    const mainResult=summary.results.find(r=>r.name==='validator-only-main');
    if (!mainResult || mainResult.status!=='passed') process.exitCode=1;
}
main().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
