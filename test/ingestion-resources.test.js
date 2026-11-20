const {test}=require('node:test');
const assert=require('node:assert/strict');
const {checkResources,availableMemory}=require('../lib/resources');
const {inspectIngestionConfiguration}=require('../lib/ingestion-validation');
const model={enabled:true,ingestion:{provider:'meteofrance-grib',domain:'arome_indian_ocean',packages:['SP1'],maxForecastHour:48,variables:['temperature_2m'],resources:{memoryBytes:1024}}};
const config={queue:{concurrency:2,retries:2},storage:{cacheDir:'/not-created/om'},ingestion:{maxRuns:1,preparationConcurrency:1}};
test('offline inspection distinguishes inactive preparations from active invalid models',()=>{
  const disabled={...model,enabled:false,ingestion:{...model.ingestion,variables:[]}};
  const report=inspectIngestionConfiguration(config,{disabled,ready:model},{rules:[{name:'temperature_2m'}]});
  assert.equal(report.valid,true);assert.equal(report.models[0].ready,false);assert.deepEqual(report.models[1].dimensions,[899,1395]);
  assert.equal(inspectIngestionConfiguration(config,{invalid:{...disabled,enabled:true}}).valid,false);
});
for(const [name,settings] of Object.entries({invalidMaxFileSize:{maxFileSize:0},negativeReserve:{resources:{memoryBytes:1,diskReserveBytes:-1}},nanReserve:{resources:{memoryBytes:1,memoryReserveBytes:NaN}},emptyVariables:{variables:[]},duplicates:{variables:['t','t']},unsafeVariable:{variables:['../../t']},invalidConcurrency:{downloadConcurrency:0},invalidTimeout:{downloadTimeoutMs:0},invalidRetention:{gribRetentionHours:-1},invalidEngine:{engine:{command:''}},sameDirectories:{workDirectory:'/not-created/om'}})){
 test(`offline inspection rejects ${name}`,()=>assert.equal(inspectIngestionConfiguration(config,{model:{...model,ingestion:{...model.ingestion,...settings}}}).valid,false));
}
test('offline inspection checks source support, profile selection and bounded pipeline',()=>{
 assert.equal(inspectIngestionConfiguration(config,{model:{...model,ingestion:{...model.ingestion,provider:'missing'}}}).valid,false);
 assert.equal(inspectIngestionConfiguration(config,{model},{rules:[{name:'different'}]}).valid,false);
 assert.equal(inspectIngestionConfiguration({...config,ingestion:{maxRuns:1,preparationConcurrency:2}},{model}).valid,false);
 assert.equal(inspectIngestionConfiguration({...config,queue:{concurrency:2,retries:NaN}},{model}).valid,false);
});
test('resource admission checks budgets before touching the filesystem',async()=>{
 let touched=false;const system={mkdir:async()=>{touched=true;},statfs:async()=>({bavail:100,bsize:1}),availableMemory:async()=>100};
 await assert.rejects(checkResources('/unused',0,{memoryBytes:1,diskReserveBytes:-1},system),/reserve/i);assert.equal(touched,false);
 await assert.rejects(checkResources('/unused',-1,{memoryBytes:1},system),/output/i);assert.equal(touched,false);
 await assert.rejects(checkResources('/unused',50,{memoryBytes:1,diskReserveBytes:51,memoryReserveBytes:0},system),/disk/);
 await assert.rejects(checkResources('/unused',0,{memoryBytes:101,diskReserveBytes:0,memoryReserveBytes:0},system),/memory/);
 const result=await checkResources('/unused',100,{memoryBytes:100,diskReserveBytes:0,memoryReserveBytes:0},system);assert.equal(result.requiredDiskBytes,100);
});
test('available memory respects the cgroup and ignores malformed or unlimited values',async()=>{
 const system=(max,current)=>({freemem:()=>1000,readFile:async file=>file==='/proc/meminfo'?'MemAvailable: 1 kB':file.endsWith('memory.max')?max:current});
 assert.equal(await availableMemory(system('500','125')),375);
 assert.equal(await availableMemory(system('max','125')),1024);
 assert.equal(await availableMemory(system('invalid','125')),1024);
 assert.equal(await availableMemory(system('100','125')),0);
});
