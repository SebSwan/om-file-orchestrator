const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createOrchestrator}=require('../lib');

test('public orchestrator integrates source, shared download queue, converter, publication and real LMDB',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ingestion-integration-'));const referenceTime='2026-11-19T12:00:00Z',validTimes=[referenceTime,'2026-11-19T13:00:00Z'];const body='GRIB-fixture';let transfers=0,conversions=0;
 const config={logging:{level:'error',file:path.join(root,'log')},queue:{concurrency:2,interval:0,intervalCap:100,timeout:10000,retries:0},storage:{cacheDir:path.join(root,'om'),maxFileSize:4},lmdb:{path:path.join(root,'lmdb'),mapSize:16*1024**2},ingestion:{maxRuns:1,preparationConcurrency:1}};
 const definition={enabled:true,name:'Fixture model',fileExtension:'.om',retentionHours:96,ingestion:{provider:'fixture',domain:'fixture',maxForecastHour:1,packages:['SP1'],variables:['t','u'],workDirectory:path.join(root,'grib'),downloadConcurrency:2,maxFileSize:1024,resources:{memoryBytes:1,memoryReserveBytes:0,diskReserveBytes:0}}};
 const source={sourceLayout:()=>({dimensions:[1,1]}),discover:async()=>({referenceTime,validTimes,missing:[],files:['a','b'].map(name=>({name:name+'.grib2',url:'https://fixture.invalid/'+name,bytes:body.length}))})};
 const engine={command:'unused'};
 const converter={engine,loadRules:async()=>[{name:'t'},{name:'u'}],convert:async(config,selectedEngine)=>{
  conversions++;assert.deepEqual(config.variables,['t','u']);assert.equal(selectedEngine,engine);assert.equal(config.inputs.length,2);for(const file of config.inputs)assert.equal(await readFile(file,'utf8'),body);
  const output=path.join(config.stagingDirectory,randomUUID(),'output');await mkdir(output,{recursive:true});const files=[];
  for(const validTime of validTimes){const stem=validTime.replace(/:/g,'').replace(/00Z$/,'');const file=path.join(output,stem+'.om');await writeFile(file,'OM-multiple-variables-fixture');await writeFile(path.join(output,stem+'.fields.json'),'{}');files.push({file,validTime,variables:['t','u'],bytes:29});config.onOutput({file:stem+'.om',bytes:29,firstObservedMs:1,lastSizeChangeMs:1});}
  return {schemaVersion:1,completed:true,model:config.model,reference_time:referenceTime,valid_times:validTimes,files,timings:{totalSeconds:0},ecCodesVersion:1,buildProfile:'test'};
 }};
 t.mock.method(globalThis,'fetch',async()=>{transfers++;return new Response(body);});
 const o=createOrchestrator(config,{models:{fixture_model:definition}},false,{sources:{fixture:source},converters:{'grib-to-om':converter}});
 // Exercise actual initialization/LMDB/queues without starting background schedules.
 o.scheduleModel=()=>{};o.scheduleCleanup=()=>{};
 const events=[];const unsubscribe=o.onIngestionEvent(event=>events.push(event));o.onIngestionEvent(()=>{throw new Error('observer unavailable');});
 try{
  const first=o.start();assert.equal(o.start(),first);await first;
  const run=await o.checkAndDownloadModel('fixture_model',definition);
  assert.equal(run.files.length,2);assert.deepEqual(run.variables,['t','u']);assert.equal(transfers,2);assert.equal(conversions,1);
  for(const file of run.files)assert.equal(o.getPath('fixture_model',file.validTime.replace(/:/g,'').replace(/00Z$/,'')),file.file);
  assert.equal(JSON.parse(await readFile(path.join(root,'om/fixture_model/latest.json'),'utf8')).completed,true);
  assert.equal(events.filter(event=>event.phase==='output-visible').length,2);assert.ok(events.some(event=>event.phase==='run-complete'));
  unsubscribe();const seen=events.length;await o.checkAndDownloadModel('fixture_model',definition);assert.equal(events.length,seen);assert.equal(transfers,2);assert.equal(conversions,1);
  assert.equal(o.getStats().filesDownloaded,2);assert.equal(o.getIngestionState().runs,0);
 }finally{await o.stop();o.logger.close();await rm(root,{recursive:true,force:true});}
});

test('configuration CLI returns a JSON report and never starts acquisition',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'ingestion-config-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const file=path.join(root,'config.json');const model={enabled:false,ingestion:{provider:'meteofrance-grib',domain:'arome_indian_ocean',variables:[],packages:['SP1'],maxForecastHour:48}};
 const config={orchestrator:{queue:{concurrency:1},storage:{cacheDir:path.join(root,'must-not-exist')}},models:{indian:model}};
 const modelFile=path.join(root,'models.json'),globalFile=path.join(root,'global.json');
 await writeFile(modelFile,JSON.stringify({models:config.models}));
 await writeFile(file,JSON.stringify({orchestrator:config.orchestrator,modelConfigFile:'models.json'}));const run=promisify(execFile);
 const report=JSON.parse((await run(process.execPath,[path.join(__dirname,'../lib/config-cli.js'),file])).stdout);assert.equal(report.valid,true);assert.equal(report.models[0].ready,false);
 await writeFile(globalFile,JSON.stringify({orchestrator:config.orchestrator}));
 const splitReport=JSON.parse((await run(process.execPath,[path.join(__dirname,'../lib/config-cli.js'),globalFile,'--models',modelFile,'--model','indian'])).stdout);assert.deepEqual(splitReport,report);
 await assert.rejects(readFile(path.join(root,'must-not-exist')),/ENOENT/);
 model.enabled=true;await writeFile(modelFile,JSON.stringify({models:config.models}));
 await assert.rejects(run(process.execPath,[path.join(__dirname,'../lib/config-cli.js'),file]),error=>error.code===1 && JSON.parse(error.stdout).valid===false);
 await assert.rejects(run(process.execPath,[path.join(__dirname,'../lib/config-cli.js'),file,'--model','unknown']),error=>error.code===2 && /Unknown model/.test(error.stderr));
});
