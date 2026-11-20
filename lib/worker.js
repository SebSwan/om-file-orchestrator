#!/usr/bin/env node
(async()=>{
/** Isolated production pilot: HTTP metrics + one configured run, no public port required. */
const {createServer}=require('node:http');
const {readFile}=require('node:fs/promises');
const {atomicJson}=require('./grib-workflow');
const {createOrchestrator,loadConfigurations}=require('./index');
const {IngestionTelemetry}=require('./telemetry');
const configPath=process.argv[2];if(!configPath)throw new Error('Usage: pilot config.json');
const config=JSON.parse(await readFile(configPath,'utf8'));
const {modelConfig}=loadConfigurations(configPath);
const models=modelConfig.models;
const client=require('prom-client');const registry=new client.Registry();
client.collectDefaultMetrics({register:registry,prefix:'weather_ingestion_worker_'});
const telemetry=new IngestionTelemetry(client,registry);
const cgroup=async(file)=>readFile('/sys/fs/cgroup/'+file,'utf8');
if(config.requireContainerLimits!==false){
  const memory=(await cgroup('memory.max')).trim();const cpu=(await cgroup('cpu.max')).trim().split(/\s+/)[0];
  if(memory==='max'||cpu==='max')throw new Error('Pilot requires enforced cgroup CPU and memory limits');
}
for(const [metric,file] of [['memory_current_bytes','memory.current'],['memory_peak_bytes','memory.peak'],['memory_limit_bytes','memory.max']])new client.Gauge({
  name:'weather_ingestion_worker_cgroup_'+metric,help:'Worker and converter cgroup '+metric,registers:[registry],
  async collect(){try{const value=Number(await cgroup(file));if(Number.isFinite(value))this.set(value);}catch{}}
});
new client.Gauge({name:'weather_ingestion_worker_cgroup_cpu_seconds',help:'Cumulative CPU seconds for worker and converters',registers:[registry],async collect(){try{this.set(Number(/usage_usec (\d+)/.exec(await cgroup('cpu.stat'))?.[1]??0)/1e6);}catch{}}});
const state={startedAt:new Date().toISOString(),phase:'starting',models:{},error:undefined};
const orchestrator=createOrchestrator(config.orchestrator,{models:models});
if(Object.values(models).some(model=>model.enabled && model.ingestion?.provider)){
  const {createGribConverter}=await import('@spotsguru/om-file-ingestion');
  orchestrator.registerConverter('grib-to-om',createGribConverter());
}
let saving=Promise.resolve();
orchestrator.onIngestionEvent(event=>{
  telemetry.event(event);if(event.model!=='all')state.phase=event.phase;state.models[event.model]={phase:event.phase,detail:event.detail,at:new Date().toISOString()};
  // Ordered writes keep progress inspectable across process restarts.
  saving=saving.then(()=>atomicJson(config.statusFile,state)).catch(error=>console.error('Status persistence failed',error));
});
const server=createServer(async(req,res)=>{
  if(req.url==='/metrics'){res.setHeader('content-type',registry.contentType);res.end(await registry.metrics());}
  else if(req.url==='/status'){res.setHeader('content-type','application/json');res.end(JSON.stringify({...state,pipeline:orchestrator.getIngestionState()}));}
  else {res.statusCode=404;res.end();}
});
await new Promise(resolve=>server.listen(config.port??4319,'0.0.0.0',resolve));
let stopped=false;
async function stop(){if(stopped)return;stopped=true;await orchestrator.stop();await saving;await new Promise(resolve=>server.close(()=>resolve()));orchestrator.logger.close();}
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
await orchestrator.start();
for(const [model,definition] of Object.entries(models))if(definition.enabled){
  try{await orchestrator.checkNow(model);}catch(error){state.error=String(error);state.phase='failed';console.error(error);}
}
await saving;await atomicJson(config.statusFile,state);
// Cron remains owned by the orchestrator; a pinned run does not acquire another run.

})().catch(error=>{console.error(error);process.exitCode=1;});
