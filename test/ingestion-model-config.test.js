const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const path=require('node:path');
const {loadConfigurations,loadModelConfiguration,selectConfiguredModels,createOrchestrator,createOrchestratorWithDefaults}=require('../lib');
async function fixture(t){
 const root=await mkdtemp(path.join(tmpdir(),'model-config-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const configFile=path.join(root,'worker.json'),catalogue=path.join(root,'config_model.json');
 const input={modelConfigFile:'config_model.json',orchestrator:{queue:{concurrency:1},storage:{cacheDir:path.join(root,'om')},logging:{level:'error',file:path.join(root,'log')}}};
 const models={om:{enabled:true,baseUrl:'https://fixture.invalid'},grib:{enabled:false,ingestion:{provider:'meteofrance-grib',variables:['temperature_2m']}}};
 await writeFile(configFile,JSON.stringify(input));await writeFile(catalogue,JSON.stringify({models}));return {root,configFile,catalogue,input,models};
}
test('OM and GRIB share one catalogue and edits to enabled are read without hidden overrides',async t=>{
 const f=await fixture(t);let loaded=loadConfigurations(f.configFile);assert.equal(loaded.modelConfigPath,f.catalogue);assert.deepEqual(loaded.modelConfig.models,f.models);
 f.models.om.enabled=false;f.models.grib.enabled=true;await writeFile(f.catalogue,JSON.stringify({models:f.models}));loaded=loadConfigurations(f.configFile);assert.deepEqual(loaded.modelConfig.models,f.models);
});
test('worker model scope references canonical entries and never enables an inactive source',async t=>{
 const f=await fixture(t),all=loadModelConfiguration(f.catalogue);
 const selected=selectConfiguredModels(all,{modelKeys:['grib']});assert.equal(selected.models.grib.enabled,false);assert.equal(selected.models.grib,all.models.grib);assert.equal(Object.keys(all.models).length,2);
 assert.deepEqual(selectConfiguredModels(all,{modelProvider:'meteofrance-grib'}).models,selected.models);
 assert.throws(()=>selectConfiguredModels(all,{modelKeys:['missing']}),/Unknown model/);
});
test('embedded models and legacy activation filters are rejected as competing sources of truth',async t=>{
 const f=await fixture(t);
 for(const input of [{...f.input,models:f.models},{...f.input,orchestrator:{...f.input.orchestrator,models:['grib']}}]){
  await writeFile(f.configFile,JSON.stringify(input));assert.throws(()=>loadConfigurations(f.configFile),/only in config_model.json/);
 }
});
test('catalogue paths are relative to the referencing file and explicit paths remain supported',async t=>{
 const f=await fixture(t);await mkdir(path.join(f.root,'nested'));const nested=path.join(f.root,'nested/config.json');await writeFile(nested,JSON.stringify({...f.input,modelConfigFile:'../config_model.json'}));
 assert.equal(loadConfigurations(nested).modelConfigPath,f.catalogue);assert.equal(loadConfigurations(nested,f.catalogue).modelConfigPath,f.catalogue);
});
test('invalid catalogue activation or horizon fails before the orchestrator starts',async t=>{
 const f=await fixture(t);
 for(const models of [{bad:{name:'missing enabled'}},{bad:{enabled:true,maxForecastHour:-1}},{bad:[]}]){
  await writeFile(f.catalogue,JSON.stringify({models}));assert.throws(()=>loadModelConfiguration(f.catalogue),/enabled|maxForecastHour/);
 }
});
test('default factory cannot start an implicit built-in model',()=>{
 assert.throws(()=>createOrchestratorWithDefaults(),/Provide modelConfig/);
});
test('OM fractional forecast horizon comes from the model and is reapplied to each run',async t=>{
 const f=await fixture(t);const instance=createOrchestrator(f.input.orchestrator,{models:{}});t.after(()=>instance.logger.close());const accepted=[];
 instance.enqueueDownload=async(_url,_file,relative)=>{accepted.push(relative);return true;};const model={enabled:true,baseUrl:'https://fixture.invalid',fileExtension:'.om',maxForecastHour:.75};
 for(const hour of ['11','12']){
  const run=`2026-11-16T${hour}:00:00Z`;
  for(const minute of ['15','30','45'])assert.equal(await instance.processValidTime('test',model,`2026-11-16T${hour}:${minute}Z`,run),true);
  assert.equal(await instance.processValidTime('test',model,new Date(Date.parse(run)+3600000).toISOString(),run),false);
 }
 assert.equal(accepted.length,6);
});
test('an OM source disabled in the catalogue never queries its upstream status',async t=>{
 const f=await fixture(t);const instance=createOrchestrator(f.input.orchestrator,{models:{}});t.after(()=>instance.logger.close());let queried=false;
 t.mock.method(require('axios'),'get',async()=>{queried=true;throw new Error('No network permitted');});
 await instance.checkAndDownloadModel('om',{enabled:false,baseUrl:'https://fixture.invalid'});assert.equal(queried,false);
});
