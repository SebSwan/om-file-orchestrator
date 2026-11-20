/** Uses the application's existing prom-client instance/registry; no global registry. */
class IngestionTelemetry {
  current=new Map();
  constructor(client,registry){
    const metric=(kind,name,help,labels,extra={})=>new client[kind]({name:'weather_ingestion_'+name,help,labelNames:labels,registers:[registry],...extra});
    this.phase=metric('Gauge','phase','Current pipeline phase (one-hot)',['model','phase']);
    this.queue=metric('Gauge','queue','Active or waiting jobs in the bounded pipeline',['stage']);
    this.transfers=metric('Counter','downloads_total','Acquired GRIB objects',['model']);
    this.bytes=metric('Counter','download_bytes_total','GRIB bytes acquired',['model']);
    this.failures=metric('Counter','errors_total','Failed attempts or runs by phase',['model','phase']);
    this.duration=metric('Histogram','duration_seconds','Phase or run duration',['model','phase'],{buckets:[.1,1,5,15,30,60,120,300,900,1800,3600,7200]});
    this.visible=metric('Gauge','outputs_visible','OM files observed in current conversion staging',['model']);
    this.expected=metric('Gauge','outputs_expected','Expected spatial OM files for current conversion',['model']);
    this.output=metric('Counter','outputs_total','OM files written by completed conversions',['model']);
    this.disk=metric('Gauge','disk_available_bytes','Available output volume bytes at conversion admission',['model']);
    this.memory=metric('Gauge','memory_available_bytes','Available memory at conversion admission',['model']);
    this.last=metric('Gauge','last_success_timestamp_seconds','Last completed run publication',['model']);
    this.peak=metric('Gauge','conversion_peak_rss_bytes','Most recent converter peak RSS',['model']);
    this.cpu=metric('Counter','conversion_cpu_seconds_total','Converter user and system CPU seconds',['model']);
    this.cleanup=metric('Counter','grib_pruned_bytes_total','Expired GRIB cache bytes removed',['model']);
  }
  event=({model,phase,detail={}})=>{
    if(phase==='pipeline'){for(const [stage,value] of Object.entries(detail))this.queue.set({stage},value);return;}
    const phases=['preparing','downloading','conversion-queued','converting','validating','publishing','indexing','complete','failed','waiting'];
    if(phases.includes(phase)){const old=this.current.get(model);if(old)this.phase.set({model,phase:old},0);this.current.set(model,phase);this.phase.set({model,phase},1);}
    if(phase==='converting'){this.visible.set({model},0);this.expected.set({model},detail.expectedFiles??0);}
    if(phase==='output-visible')this.visible.inc({model});
    if(phase==='downloaded'){this.transfers.inc({model});this.bytes.inc({model},detail.bytes??0);}
    if(phase==='failed'||phase.endsWith('-failed'))this.failures.inc({model,phase});
    if(Number.isFinite(detail.durationMs))this.duration.observe({model,phase},detail.durationMs/1000);
    if(phase==='resources'){this.disk.set({model},detail.diskBytes);this.memory.set({model},detail.memoryBytes);}
    if(phase==='converted'){
      this.output.inc({model},detail.files??0);
      if(detail.resources){this.peak.set({model},detail.resources.maxRssKiB*1024);this.cpu.inc({model},detail.resources.userSeconds+detail.resources.systemSeconds);}
    }
    if(phase==='run-complete')this.last.set({model},Date.now()/1000);
    if(phase==='grib-pruned')this.cleanup.inc({model},detail.bytes??0);
  };
}

module.exports = { IngestionTelemetry };
