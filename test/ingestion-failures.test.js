const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,readFile,readdir,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ingestWorkflow,runDirectory}=require('../lib/grib-workflow');
async function fixture(t) {
 const root=await mkdtemp(path.join(tmpdir(),'ingestion-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const referenceTime='2026-11-19T12:00:00Z',body=Buffer.from('GRIB-synthetic-fixture');
 const plan={referenceTime,missing:[],validTimes:[referenceTime],files:[{name:'input.grib2',url:'https://fixture.invalid/never-requested',bytes:body.length,etag:'fixed'}]};
 let downloads=0,conversions=0,indexed=0;
 const options={model:'model',storageDirectory:path.join(root,'om'),workDirectory:path.join(root,'grib'),engine:{command:'unused'},rules:[],variables:['t'],maxForecastHour:0,retries:0,expectedDimensions:[1,1],resources:{memoryBytes:1,memoryReserveBytes:0,diskReserveBytes:0},fetcher:async()=>{downloads++;return new Response(body);},register:async()=>{indexed++;}};
 const convert=async config=>{
  conversions++;const output=path.join(config.stagingDirectory,randomUUID(),'output');await mkdir(output,{recursive:true});const files=[];
  for(const validTime of plan.validTimes){const stem=validTime.replace(/:/g,'').replace(/00Z$/,'');const file=path.join(output,stem+'.om');await writeFile(file,'OM-synthetic-output');await writeFile(path.join(output,stem+'.fields.json'),'{}');files.push({file,validTime,variables:['t'],bytes:19});}
  return {schemaVersion:1,completed:true,model:config.model,reference_time:config.referenceTime,valid_times:[...plan.validTimes],files,timings:{totalSeconds:0},ecCodesVersion:1,buildProfile:'test'};
 };
 options.convert=convert;
 const work=runDirectory(options.workDirectory,'model',referenceTime);
 return {root,plan,options,convert,work,body,counts:()=>({downloads,conversions,indexed})};
}
test('HTTP retry is bounded and publishes only after the successful acquisition',async t=>{
 const f=await fixture(t);const fetcher=f.options.fetcher;let attempts=0;
 f.options.retries=1;f.options.fetcher=async()=>++attempts===1?new Response('failure',{status:503}):fetcher();
 await ingestWorkflow(f.plan,f.options);assert.equal(attempts,2);assert.deepEqual(f.counts(),{downloads:1,conversions:1,indexed:1});
});
for(const body of ['GRI','GRIB-payload-too-large'])test(`rejects incorrect object size (${body.length} bytes) without partial cache or publication`,async t=>{
 const f=await fixture(t);f.plan.files[0].bytes=4;f.options.fetcher=async()=>new Response(body);
 await assert.rejects(ingestWorkflow(f.plan,f.options),/Truncated|exceeds catalogue/);
 assert.deepEqual(await readdir(path.join(f.work,'inputs')),[]);assert.equal(f.counts().indexed,0);
 assert.equal(JSON.parse(await readFile(path.join(f.work,'state.json'),'utf8')).phase,'failed');
});
for(const corrupt of [false,true])test(`conversion retry ${corrupt?'reacquires a corrupted':'reuses a valid'} GRIB cache`,async t=>{
 const f=await fixture(t);f.options.convert=async()=>{throw new Error('converter stopped');};await assert.rejects(ingestWorkflow(f.plan,f.options),/converter stopped/);
 if(corrupt){const file=(await readdir(path.join(f.work,'inputs'))).find(file=>file.endsWith('.grib2'));await writeFile(path.join(f.work,'inputs',file),'GRIB-corrupted-cache');}
 f.options.convert=f.convert;await ingestWorkflow(f.plan,f.options);assert.equal(f.counts().downloads,corrupt?2:1);assert.equal(f.counts().indexed,1);
});
test('a second process cannot convert the same run while its lock is held',async t=>{
 const f=await fixture(t);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);
 f.options.convert=async config=>{started();await gate;return f.convert(config);};
 const first=ingestWorkflow(f.plan,f.options);await ready;
 try{await assert.rejects(ingestWorkflow(f.plan,f.options),/already active/);assert.equal(f.counts().downloads,1);}finally{release();await first;}
 assert.equal(f.counts().indexed,1);await assert.rejects(readFile(path.join(f.work,'lock.json')),/ENOENT/);
});
for(const [name,mutate] of [
 ['wrong run',r=>r.reference_time='2026-11-19T06:00:00Z'],
 ['wrong model',r=>r.model='another'],
 ['incomplete result',r=>r.completed=false],
 ['unselected variable',r=>r.files[0].variables=['not-selected']],
 ['missing requested variable',r=>r.files[0].variables=[]],
])test(`does not publish converter result with ${name}`,async t=>{
 const f=await fixture(t);f.options.convert=async config=>{const result=await f.convert(config);mutate(result);return result;};
 await assert.rejects(ingestWorkflow(f.plan,f.options),/Invalid|selected variable/i);assert.equal(f.counts().indexed,0);
 await assert.rejects(readFile(path.join(f.options.storageDirectory,'model/latest.json')),/ENOENT/);
});
test('rejects an output directory outside staging without moving its files',async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await mkdir(outside);const file=path.join(outside,'2026-11-19T1200.om');await writeFile(file,'OM-external-file');await writeFile(path.join(outside,'2026-11-19T1200.fields.json'),'{}');
 f.options.convert=async config=>({...await f.convert(config),files:[{file,validTime:f.plan.referenceTime,variables:['t'],bytes:16}]});
 await assert.rejects(ingestWorkflow(f.plan,f.options),/outside staging/);assert.equal(await readFile(file,'utf8'),'OM-external-file');assert.equal(f.counts().indexed,0);
});
test('missing variables over a whole run are refused',async t=>{
 const f=await fixture(t);f.options.variables=['t','u'];await assert.rejects(ingestWorkflow(f.plan,f.options),/selected variable/i);assert.equal(f.counts().indexed,0);
});
test('resource refusal occurs before invoking the converter',async t=>{
 const f=await fixture(t);f.options.resources.memoryBytes=Number.MAX_SAFE_INTEGER;f.options.resources.memoryReserveBytes=0;
 await assert.rejects(ingestWorkflow(f.plan,f.options),/memory/);assert.equal(f.counts().conversions,0);assert.equal(f.counts().indexed,0);
});

test('a variable absent at +0 is accepted if it exists later in the run',async t=>{
 const f=await fixture(t);f.plan.validTimes.push('2026-11-19T13:00:00Z');f.options.maxForecastHour=1;f.options.variables=['t','u'];
 f.options.convert=async config=>{const result=await f.convert(config);result.files[1].variables.push('u');return result;};
 const run=await ingestWorkflow(f.plan,f.options);assert.deepEqual(run.variables,['t','u']);assert.equal(run.files[0].variables.length,1);assert.equal(f.counts().indexed,1);
});
test('duplicate output times cannot replace a missing forecast step',async t=>{
 const f=await fixture(t);f.plan.validTimes.push('2026-11-19T13:00:00Z');f.options.maxForecastHour=1;
 f.options.convert=async config=>{const result=await f.convert(config);result.files[1]=result.files[0];return result;};
 await assert.rejects(ingestWorkflow(f.plan,f.options),/duplicate valid times/);assert.equal(f.counts().indexed,0);
});
