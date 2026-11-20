export interface EngineOptions { command: string; args?: string[]; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeoutMs?: number }
export interface VariableRule { name: string; selector: Record<string, string | number>; unit: string; transform?: string; scaleFactor?: number }
export interface ConvertedFile { file: string; validTime: string; variables: string[]; bytes: number }
export interface ConversionResult { files: ConvertedFile[]; valid_times: string[]; model: string; reference_time: string; completed: boolean; timings: unknown; ecCodesVersion: number; buildProfile: string }
export interface GribConverter { engine?: EngineOptions; loadRules(file?: string): Promise<VariableRule[]>; convert: (...args: any[]) => Promise<ConversionResult> }
export interface RunPlan { referenceTime: string; validTimes: string[]; missing: string[]; files: {name:string;url:string;bytes:number;etag?:string}[] }
export interface SourceAdapter { discover(config: any): Promise<RunPlan>; sourceLayout(config: any): {dimensions: [number, number]} }
export interface IngestionEvent { model: string; phase: string; detail?: any }
export interface ResourceBudget { memoryBytes: number; memoryReserveBytes?: number; diskReserveBytes?: number }
export interface GribConfig { provider: string; converter?: string; domain: string; packages: string[]; variables: string[]; maxForecastHour: number; referenceTime?: string; baseUrl?: string; publicationLagHours?: number; workDirectory?: string; rulesFile?: string; gribRetentionHours?: number; downloadConcurrency?: number; downloadTimeoutMs?: number; maxFileSize?:number; resources?: ResourceBudget; engine?: EngineOptions; unknownFields?: 'report'|'preserve'|'error' }
export class WeatherOrchestratorSimple {
  constructor(config: any, modelConfig: any, fakeMode?: boolean);
  [key: string]: any;
  registerConverter(name: string, converter: GribConverter): this;
  registerSource(name: string, source: SourceAdapter): this;
  onIngestionEvent(listener: (event: IngestionEvent) => void): () => boolean;
  getIngestionState(): {runs:number;preparationActive:number;preparationQueued:number;conversionActive:number;conversionQueued:number};
  start(): Promise<void>; stop(): Promise<void>;
}
export function createOrchestrator(config:any, models:any, fakeMode?:boolean, options?: {converters?:Record<string,GribConverter>;sources?:Record<string,SourceAdapter>}): WeatherOrchestratorSimple;
export function createOrchestratorWithDefaults(options?:any): WeatherOrchestratorSimple;
export function loadConfigurations(configPath?:string, modelConfigPath?:string): {config:any;modelConfig:any;modelConfigPath:string};
export class IngestionTelemetry { constructor(client:any,registry:any); event(event:IngestionEvent):void }
export const meteofrance: SourceAdapter & {discoverRun(config:any,now?:number,fetcher?:typeof fetch):Promise<RunPlan>};
export function ingestWorkflow(plan:RunPlan,options:any):Promise<any>;
export const version: string;

export class ForecastHistory {
  constructor(cache:any,root:string,model:string,validate:(file:string)=>Promise<boolean>,report:(error:unknown,model:string)=>void,inFlight?:ReadonlySet<string>);
  shouldDownload(validTime:string,referenceTime:string):boolean;
  sync(now?:number):Promise<void>;
}
export function setupForecastHistory(orch:any,models:Record<string,any>,root:string,validate:(file:string)=>Promise<boolean>,report:(error:unknown,model:string)=>void): {start():Promise<void>;stop():Promise<void>} | undefined;

export interface IngestionConfigurationReport {
  valid:boolean;errors:string[];
  models:Array<{model:string;enabled:boolean;ready:boolean;provider:string;variables?:string[];packages?:string[];maxForecastHour?:number;dimensions?:[number,number];storageDirectory?:string;workDirectory?:string;errors:string[];warnings:string[]}>;
}
export function inspectIngestionConfiguration(config:any,models:Record<string,any>,options?:{sources?:Record<string,SourceAdapter>;rules?:VariableRule[]}):IngestionConfigurationReport;

export function loadModelConfiguration(file:string):{models:Record<string,any>};
export function selectConfiguredModels(modelConfig:{models:Record<string,any>},scope?:{modelKeys?:string[];modelProvider?:string}):{models:Record<string,any>};
