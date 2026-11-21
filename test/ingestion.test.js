const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp,rm,writeFile,readFile,mkdir} = require('node:fs/promises');
const path = require('node:path');
const {tmpdir} = require('node:os');
const {discoverRun,parseListing,sourceLayout} = require('../lib/sources/meteofrance');
const {ingestWorkflow,runDirectory,pruneGribRuns} = require('../lib/grib-workflow');

test('provider pagination, exact package completeness, UTC paths and horizon',async()=>{
  const referenceTime='2026-11-17T03:00:00Z';const calls=[];
  const prefix=`pnt/${referenceTime}/arome/001/SP1/`;
  const object=(span)=>`<Contents><Key>${prefix}arome__001__SP1__${span}__${referenceTime}.grib2</Key><Size>42</Size><ETag>"tag"</ETag></Contents>`;
  const fetcher=async(url)=>{calls.push(String(url));return new Response(`<ListBucketResult>${calls.length===1?object('00H'):object('01H')}<IsTruncated>${calls.length===1}</IsTruncated>${calls.length===1?'<NextContinuationToken>a&amp;b</NextContinuationToken>':''}</ListBucketResult>`);};
  const plan=await discoverRun({domain:'arome_france_hd',packages:['SP1'],maxForecastHour:1,referenceTime},Date.now(),fetcher);
  assert.equal(plan.files.length,2);assert.equal(plan.missing.length,0);assert.match(calls[1],/continuation-token=a%26b/);
  assert.equal(plan.validTimes[1],'2026-11-17T04:00:00Z');
  assert.throws(()=>parseListing('<Error>no</Error>'),/catalogue/);
  assert.throws(()=>parseListing('<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>'),/continuation/);
  assert.deepEqual(sourceLayout({domain:'arome_france',packages:['SP1'],maxForecastHour:7}).spans,['00H06H','07H12H']);
  const missing=await discoverRun({domain:'arome_france_hd',packages:['SP1'],maxForecastHour:1,referenceTime},0,(async()=>new Response('<ListBucketResult/>')));
  assert.equal(missing.missing.length,2);
});

test('workflow publication, checksums, recovery after index failure and idempotency',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mf-workflow-'));let downloads=0,conversions=0,indexes=0;let failIndex=true;
  const referenceTime='2026-11-17T03:00:00Z';const validTime='2026-11-17T04:00:00Z';const body=Buffer.from('GRIB-test-fixture');
  const plan={referenceTime,missing:[],validTimes:[validTime],files:[{name:'input.grib2',url:'https://fixture.invalid/input.grib2',bytes:body.length}]};
  const options={model:'test',storageDirectory:path.join(root,'data'),workDirectory:path.join(root,'work'),engine:{command:'unused'},rules:[],variables:['temperature_2m'],maxForecastHour:1,retries:0,
    fetcher:(async()=>{downloads++;return new Response(body);}),
    convert:async config=>{
      conversions++;const output=path.join(config.stagingDirectory,'test-output');await mkdir(output,{recursive:true});
      const file=path.join(output,'2026-11-17T0400.om');await writeFile(file,'OM3-test-validated-by-engine');
      await writeFile(path.join(output,'2026-11-17T0400.fields.json'),JSON.stringify({fields:[]}));
      return {schemaVersion:1,model:config.model,reference_time:referenceTime,valid_times:[validTime],completed:true,
        files:[{file,validTime,variables:['temperature_2m'],bytes:27}],timings:{totalSeconds:0,decodeTransformSeconds:0,writeSeconds:0},ecCodesVersion:24400,buildProfile:'test'};
    },
    register:async run=>{indexes++;assert.equal(await readFile(run.files[0].file,'utf8'),'OM3-test-validated-by-engine');if(failIndex)throw new Error('index offline');}
  };
  try{
    await assert.rejects(ingestWorkflow(plan,options),/index offline/);
    failIndex=false;const run=await ingestWorkflow(plan,options);
    assert.equal(downloads,1);assert.equal(conversions,1);assert.equal(indexes,2);
    assert.equal(run.files[0].file,path.join(runDirectory(options.storageDirectory,'test',referenceTime),'2026-11-17T0400.om'));
    await readFile(path.join(path.dirname(run.files[0].file),'001H.fields.json'));
    const latest=JSON.parse(await readFile(path.join(root,'data/test/latest.json'),'utf8'));assert.equal(latest.reference_time,referenceTime);
    await ingestWorkflow(plan,options);assert.equal(conversions,1);
    await assert.rejects(ingestWorkflow(plan,{...options,variables:['other']}),/different configuration/);
    await writeFile(run.files[0].file,'corrupted');await assert.rejects(ingestWorkflow(plan,options),/changed/);
  }finally{await rm(root,{recursive:true});}
});

test('failed coverage is never published or indexed; corrupt GRIB is rejected',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mf-failed-'));let indexed=false;
  const referenceTime='2026-11-17T03:00:00Z';const plan={referenceTime,missing:[],validTimes:[referenceTime],files:[{name:'file.grib',url:'https://fixture.invalid',bytes:4}]};
  const options={model:'test',storageDirectory:path.join(root,'data'),workDirectory:path.join(root,'work'),rules:[],variables:['temperature_2m'],maxForecastHour:0,engine:{command:'unused'},retries:0,
    convert:async()=>{throw new Error('Unexpected converter invocation');},register:async()=>{indexed=true;},fetcher:(async()=>new Response('HTML'))};
  try{
    await assert.rejects(ingestWorkflow(plan,options),/not a GRIB/);assert.equal(indexed,false);
    await assert.rejects(readFile(path.join(root,'data/test/latest.json')));
    options.fetcher=(async()=>new Response('GRIB'));
    options.convert=async()=>({schemaVersion:1,model:'test',reference_time:referenceTime,valid_times:[],completed:true,files:[],timings:{totalSeconds:0,decodeTransformSeconds:0,writeSeconds:0},ecCodesVersion:1,buildProfile:'test'});
    await assert.rejects(ingestWorkflow(plan,options),/expected valid times/);assert.equal(indexed,false);
  }finally{await rm(root,{recursive:true});}
});

test('Indian Ocean catalogue covers all 537 objects and omits only known absent +0 packages',async()=>{
 const referenceTime='2026-11-19T12:00:00Z';const packages=['SP1','SP2','SP3','HP1','HP2','HP3','IP1','IP2','IP3','IP4','IP5'];let request='';
 const objects=[];
 for(let h=0;h<=48;h++)for(const p of packages){if(h===0&&['HP3','IP4'].includes(p))continue;objects.push(`<Contents><Key>pnt/${referenceTime}/arome-om/INDIEN/0025/${p}/arome-om-INDIEN__0025__${p}__${String(h).padStart(3,'0')}H__${referenceTime}.grib2</Key><Size>100</Size></Contents>`);}
 const plan=await discoverRun({domain:'arome_indian_ocean',packages,maxForecastHour:48,referenceTime},0,(async(url)=>{request=String(url);return new Response('<ListBucketResult>'+objects.join('')+'</ListBucketResult>');}));
 assert.equal(plan.files.length,537);assert.equal(plan.validTimes.length,49);assert.deepEqual(plan.missing,[]);assert.match(decodeURIComponent(request),/arome-om\/INDIEN\/0025/);
 assert.deepEqual(sourceLayout({domain:'arome_indian_ocean',packages,maxForecastHour:48}).dimensions,[899,1395]);
});

test('GRIB retention is independent and preserves active or failed work',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'grib-retention-'));
 try{
  for(const [hour,phase] of [['00','complete'],['06','failed'],['12','complete']]){const dir=runDirectory(root,'test',`2026-11-19T${hour}:00:00Z`);await mkdir(path.join(dir,'inputs'),{recursive:true});await writeFile(path.join(dir,'inputs/input.grib'),'GRIB');await writeFile(path.join(dir,'state.json'),JSON.stringify({phase,updatedAt:'2026-11-19T12:00:00Z'}));if(hour==='12')await writeFile(path.join(dir,'lock.json'),'active');}
  assert.equal(await pruneGribRuns(root,'test',1,Date.parse('2026-11-19T14:00:00Z')),4);
  await assert.rejects(readFile(path.join(runDirectory(root,'test','2026-11-19T00:00:00Z'),'inputs/input.grib')));
  for(const h of ['06','12'])assert.equal(await readFile(path.join(runDirectory(root,'test',`2026-11-19T${h}:00:00Z`),'inputs/input.grib'),'utf8'),'GRIB');
 }finally{await rm(root,{recursive:true});}
});

const {IngestionPipeline}=require('../lib/ingestion-pipeline');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('bounded admission overlaps preparation with conversion and serializes converters',async()=>{
 const p=new IngestionPipeline(2,1);assert.ok(p.admit('a'));assert.ok(p.admit('b'));assert.equal(p.admit('c'),false);
 const ready=deferred(),finish=deferred();let secondPrepared=false,secondConverting=false;
 const a=p.preparation.run(async()=>{}).then(()=>p.conversion.run(async()=>{ready.resolve();await finish.promise;}));
 await ready.promise;
 const b=p.preparation.run(async()=>{secondPrepared=true;}).then(()=>p.conversion.run(async()=>{secondConverting=true;}));
 await new Promise(r=>setTimeout(r,10));assert.equal(secondPrepared,true);assert.equal(secondConverting,false);assert.equal(p.snapshot().conversionQueued,1);
 finish.resolve();await Promise.all([a,b]);assert.equal(secondConverting,true);assert.equal(p.snapshot().conversionActive,0);
 p.release('a');assert.ok(p.admit('c'));p.release('b');p.release('c');assert.equal(p.snapshot().runs,0);
 await assert.rejects(p.conversion.run(async()=>{throw new Error('conversion failed');}),/failed/);assert.equal(p.snapshot().conversionActive,0);
});

const {createOrchestrator}=require('../lib');
test('publication index preserves newer runs, skips identical paths and propagates LMDB failures',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'mf-orchestrator-'));
  const o=createOrchestrator({logging:{level:'error',file:path.join(dir,'log')},queue:{},storage:{cacheDir:dir}},{models:{}});
  const current=path.join(dir,'model/2026/11/18/0600Z/2026-11-18T1200.om');let existing=current;let writes=0;
  o.pathCache={get:()=>existing,set:async(_m,_t,p)=>{writes++;existing=p;return true;}};
  const run=(time,file)=>({model:'model',reference_time:time,completed:true,signature:'test',variables:['temperature_2m'],valid_times:['2026-11-18T12:00:00Z'],files:[{file,validTime:'2026-11-18T12:00:00Z',variables:['temperature_2m'],bytes:1,sha256:'test'}]});
  try{
    await o.registerPublishedRun(run('2026-11-18T03:00:00Z',path.join(dir,'model/2026/11/18/0300Z/2026-11-18T1200.om')));assert.equal(writes,0);
    await o.registerPublishedRun(run('2026-11-18T06:00:00Z',current));assert.equal(writes,0);
    const newer=path.join(dir,'model/2026/11/18/0900Z/2026-11-18T1200.om');await o.registerPublishedRun(run('2026-11-18T09:00:00Z',newer));assert.equal(writes,1);
    o.pathCache.set=async()=>false;existing='';await assert.rejects(o.registerPublishedRun(run('2026-11-18T09:00:00Z',newer)),/LMDB registration failed/);
    assert.equal(o.stats.dbErrors,1);
    await o.checkAndDownloadModel('disabled',{enabled:true,managed:false});
    await o.checkAndDownloadModel('disabled',{enabled:false,ingestion:{provider:'meteofrance-grib'}});
  }finally{o.logger.close();await rm(dir,{recursive:true});}
});

test('public registration rejects an empty or unknown selection before source discovery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'orchestrator-contract-'));
  const o = createOrchestrator({logging:{level:'error',file:path.join(root,'log')},queue:{},storage:{cacheDir:root}}, {models:{}});
  let catalogues=0;
  o.registerSource('fixture', {discover:async()=>{catalogues++;return {missing:['not-ready']};},sourceLayout:()=>({dimensions:[1,1]})});
  o.registerConverter('grib-to-om', {loadRules:async()=>[{name:'temperature_2m'}],convert:async()=>{throw new Error('Unexpected conversion');}});
  try {
    await assert.rejects(o.checkAndDownloadModel('model',{enabled:true,ingestion:{provider:'fixture',maxForecastHour:0,variables:[]}}),/explicit unique variable/);
    await assert.rejects(o.checkAndDownloadModel('model',{enabled:true,ingestion:{provider:'fixture',maxForecastHour:0,variables:['unknown']}}),/Unknown selected variable/);
    assert.equal(catalogues,0);
    const model={enabled:true,ingestion:{provider:'fixture',maxForecastHour:0,variables:['temperature_2m']}};
    const [a,b]=await Promise.all([o.checkAndDownloadModel('model',model),o.checkAndDownloadModel('model',model)]);
    assert.equal(a.status,'waiting');assert.deepEqual(a,b);assert.equal(catalogues,1);assert.equal(o.getIngestionState().runs,0);
  } finally {o.logger.close();await rm(root,{recursive:true});}
});

test('a run already published by this process is not verified again on the next tick', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'orchestrator-published-'));
  const o=createOrchestrator({logging:{level:'error',file:path.join(root,'log')},queue:{},storage:{cacheDir:root}},{models:{}});
  const referenceTime='2026-11-20T12:00:00Z';
  o.registerSource('fixture',{discover:async()=>({referenceTime,missing:[],validTimes:[referenceTime],files:[{name:'a.grib2',url:'https://test.invalid/a',bytes:1}]}),sourceLayout:()=>({dimensions:[1,1]})});
  o.registerConverter('grib-to-om',{loadRules:async()=>[{name:'t'}],convert:async()=>{throw new Error('Unexpected conversion');}});
  try {
    o.grib.published.set('model',referenceTime);
    const result=await o.checkAndDownloadModel('model',{enabled:true,ingestion:{provider:'fixture',maxForecastHour:0,variables:['t']}});
    assert.deepEqual(result,{status:'already-published',referenceTime});
  } finally {o.logger.close();await rm(root,{recursive:true});}
});

test('shared runtime refuses extra models while admission is full and drains on stop', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'orchestrator-admission-'));
  const o=createOrchestrator({ingestion:{maxRuns:1},logging:{level:'error',file:path.join(root,'log')},queue:{},storage:{cacheDir:root}},{models:{}});
  const entered=deferred(),finish=deferred();
  o.registerSource('fixture',{discover:async()=>{entered.resolve();await finish.promise;return {missing:['pending']};},sourceLayout:()=>({dimensions:[1,1]})});
  o.registerConverter('grib-to-om',{loadRules:async()=>[{name:'t'}],convert:async()=>{throw new Error('Unexpected conversion');}});
  try {
    const model={enabled:true,ingestion:{provider:'fixture',maxForecastHour:0,variables:['t']}};
    const first=o.checkAndDownloadModel('first',model);await entered.promise;
    assert.equal((await o.checkAndDownloadModel('second',model)).status,'deferred');
    let stopped=false;const stop=o.stop().then(()=>{stopped=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(stopped,false);
    finish.resolve();await first;await stop;assert.equal(o.getIngestionState().runs,0);
    assert.equal(await o.checkAndDownloadModel('third',model),undefined);
  } finally {finish.resolve();o.logger.close();await rm(root,{recursive:true});}
});

test('GRIB retention preserves a completed cache with an invalid completion date',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'grib-invalid-date-'));const dir=runDirectory(root,'test','2026-11-19T00:00:00Z');
 try{await mkdir(path.join(dir,'inputs'),{recursive:true});await writeFile(path.join(dir,'inputs/input.grib'),'GRIB');await writeFile(path.join(dir,'state.json'),JSON.stringify({phase:'complete',updatedAt:'invalid'}));
 assert.equal(await pruneGribRuns(root,'test',0),0);assert.equal(await readFile(path.join(dir,'inputs/input.grib'),'utf8'),'GRIB');
 }finally{await rm(root,{recursive:true,force:true});}
});
