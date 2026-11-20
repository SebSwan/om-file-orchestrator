const {test}=require('node:test');
const assert=require('node:assert/strict');
const {IngestionTelemetry}=require('../lib');
function registry(){
 const metrics=new Map();
 class Metric{
  constructor(options){this.options=options;this.samples=new Map();metrics.set(options.name,this);}
  key(labels){assert.deepEqual(Object.keys(labels).sort(),[...this.options.labelNames].sort());return JSON.stringify(labels);}
  set(labels,value){assert.ok(Number.isFinite(value));this.samples.set(this.key(labels),value);}
  inc(labels,value=1){assert.ok(Number.isFinite(value));const key=this.key(labels);this.samples.set(key,(this.samples.get(key)??0)+value);}
  observe(labels,value){this.set(labels,value);}
 }
 return {client:{Gauge:Metric,Counter:Metric,Histogram:Metric},get:(name,labels)=>metrics.get('weather_ingestion_'+name).samples.get(JSON.stringify(labels))};
}
test('telemetry exposes conversion progress independently of publication and clears it for the next run',()=>{
 const r=registry(),telemetry=new IngestionTelemetry(r.client,{}),labels={model:'indian'};
 telemetry.event({...labels,phase:'converting',detail:{expectedFiles:49}});telemetry.event({...labels,phase:'output-visible'});
 assert.equal(r.get('outputs_expected',labels),49);assert.equal(r.get('outputs_visible',labels),1);
 assert.equal(r.get('phase',{...labels,phase:'converting'}),1);
 telemetry.event({...labels,phase:'failed'});assert.equal(r.get('phase',{...labels,phase:'converting'}),0);assert.equal(r.get('phase',{...labels,phase:'failed'}),1);
 telemetry.event({...labels,phase:'converting',detail:{expectedFiles:49}});assert.equal(r.get('outputs_visible',labels),0);
});
test('telemetry distinguishes acquired bytes, cached inputs, engine resources and failures',()=>{
 const r=registry(),telemetry=new IngestionTelemetry(r.client,{}),labels={model:'indian'};
 telemetry.event({...labels,phase:'downloaded',detail:{bytes:100,durationMs:500}});telemetry.event({...labels,phase:'download-cached',detail:{bytes:100}});
 assert.equal(r.get('download_bytes_total',labels),100);assert.equal(r.get('downloads_total',labels),1);assert.equal(r.get('duration_seconds',{...labels,phase:'downloaded'}),.5);
 telemetry.event({...labels,phase:'converted',detail:{files:49,resources:{maxRssKiB:100,userSeconds:2,systemSeconds:1}}});
 assert.equal(r.get('conversion_peak_rss_bytes',labels),102400);assert.equal(r.get('conversion_cpu_seconds_total',labels),3);
 telemetry.event({...labels,phase:'catalogue-failed'});assert.equal(r.get('errors_total',{...labels,phase:'catalogue-failed'}),1);
 telemetry.event({model:'all',phase:'pipeline',detail:{conversionQueued:1}});assert.equal(r.get('queue',{stage:'conversionQueued'}),1);
});
