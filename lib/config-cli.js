#!/usr/bin/env node
const {parseArgs}=require('node:util');
const {loadConfigurations,selectConfiguredModels}=require('./model-configuration');
const {inspectIngestionConfiguration}=require('./ingestion-validation');
async function main() {
 const {values,positionals}=parseArgs({allowPositionals:true,options:{model:{type:'string'},models:{type:'string'},'check-profile':{type:'boolean'},profile:{type:'string'}}});
 if(positionals.length!==1)throw new Error('Usage: om-grib-config config.json [--models config_model.json] [--model id] [--check-profile] [--profile profile.json]');
 const loaded=loadConfigurations(positionals[0],values.models);const config=loaded.config;
 const models=selectConfiguredModels(loaded.modelConfig,{modelKeys:values.model?[values.model]:undefined}).models;
 let rules;
 if(values['check-profile'] || values.profile){
  const {loadRules}=await import('@spotsguru/om-file-ingestion');rules=await loadRules(values.profile);
 }
 const report=inspectIngestionConfiguration(config,models,{rules});
 process.stdout.write(JSON.stringify(report,null,2)+'\n');if(!report.valid)process.exitCode=1;
}
main().catch(error=>{console.error(error.message);process.exitCode=2;});
