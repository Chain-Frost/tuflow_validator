import pathlib,os,hashlib,json,zipfile,subprocess
b=pathlib.Path(os.environ['TEMP'])/'tpv-acceptance-20261123';e=b/'evidence';records=[]
for name in ['d1','before','d2']:
 src=b/name;archive=e/('source-'+name+'.zip');vsix=b/(name+'.vsix')
 sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 with zipfile.ZipFile(vsix) as z:
  runtime={f'extension/out/{p.stem}.js' for p in (src/'src').glob('*.ts')}
  assert runtime.issubset(z.namelist())
  for entry in runtime:
   assert z.read(entry)==(src/entry.removeprefix('extension/')).read_bytes()
   assert z.read(entry)==(b/'installed'/name/'Chain-Frost.tuflow-path-validator-0.2.6'/entry.removeprefix('extension/')).read_bytes()
  assert z.testzip() is None
  records.append({'build':name,'commit':subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip(),'sourceArchiveSha256':sha(archive),'vsixSha256':sha(vsix),'runtimeModules':len(runtime),'archiveEntries':len(z.namelist()),'compiledPackagedInstalledRuntimeIdentical':True,'sourceChanges':subprocess.check_output(['git','-C',str(src),'diff','--name-only','--','src','package.json','package-lock.json'],text=True).strip()})
records.append({'driverCommit':records[0]['commit'],'driverSha256':sha(b/'d1/scripts/benchmarks/core-baseline.cjs'),'nodeZipSha256':sha(b/'node-alt.zip')})
(e/'provenance.json').write_text(json.dumps(records,indent=2))
print(json.dumps(records,indent=2))
