const fs = require('fs'), path = require('path'), v = require('vscode');
const pause = ms => new Promise(r => setTimeout(r, ms));
exports.run = async () => {
 const dir = fs.mkdtempSync(path.join(process.env.TPV_PARENT, 'lifecycle-'));
 const r = {fixture: dir, vscode: v.version, pid: process.pid, observations: [], closeEvents: []};
 const documents = [];
 const closed = v.workspace.onDidCloseTextDocument(d => {if(d.fileName.toLowerCase().startsWith(dir.toLowerCase())) r.closeEvents.push({file: d.fileName, time: new Date().toISOString()});});
 const snapshot = label => r.observations.push({label, time: new Date().toISOString(), documents: documents.map(d => ({uri: d.uri.toString(), isClosed: d.isClosed, diagnostics: v.languages.getDiagnostics(d.uri).map(x => ({code: typeof x.code === 'object' ? x.code.value : x.code, message: x.message}))})), memory: process.memoryUsage(), cpu: process.cpuUsage()});
 try {
  fs.writeFileSync(path.join(dir, 'child.tgc'), 'Read GIS Mat == missing.csv\n');
  for(const name of ['RootA.tcf','RootB.tcf']) {
   fs.writeFileSync(path.join(dir, name), 'Geometry Control File == child.tgc\n');
   const d = await v.workspace.openTextDocument(v.Uri.file(path.join(dir, name))); documents.push(d);
   await v.window.showTextDocument(d, {preview: false});
  }
  await v.extensions.getExtension('Chain-Frost.tuflow-path-validator').activate(); await pause(1800); snapshot('open');
  await v.commands.executeCommand('workbench.action.closeAllEditors'); await pause(700); snapshot('tabs-closed');
  const edit = new v.WorkspaceEdit(); documents.forEach(d => edit.deleteFile(d.uri));
  r.deleteAccepted = await v.workspace.applyEdit(edit); await pause(1800); snapshot('workspace-delete');
 } catch(e) {r.error = String(e.stack || e);} finally {
  closed.dispose(); await v.commands.executeCommand('workbench.action.closeAllEditors');
  fs.rmSync(dir, {recursive: true, force: true, maxRetries: 10, retryDelay: 200}); await pause(500);
  r.fixtureRemoved = !fs.existsSync(dir); fs.writeFileSync(process.env.TPV_OUTPUT, JSON.stringify(r, null, 2));
 }
};
