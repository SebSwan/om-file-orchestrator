"""Offline preparation from saved public XML metadata; never downloads model data."""
import collections,copy,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONFIG=ROOT/'examples/meteofrance'
snapshot_path=CONFIG/'catalogue/ovh-observed-20261119.json'
snapshot=json.loads(snapshot_path.read_text())
base=snapshot['baseUrl'];reference=snapshot['referenceTime']
groups=collections.defaultdict(list)
for obj in snapshot['objects']:
    components=obj['key'].split('/')
    groups['/'.join(components[2:-2])].append(obj)
known={
 'arome/0025':('meteofrance_arome_france0025_native','AROME France 0,025°','arome_france','adapter-present'),
 'arome/001':('meteofrance_arome_france_hd_native','AROME France 0,01°','arome_france_hd','adapter-present'),
 'aromeifs/0025':('meteofrance_arome_ifs_france0025_native','AROME-IFS France 0,025°','arome_ifs_france','adapter-required'),
 'arpege/01':('meteofrance_arpege_europe_native','ARPEGE Europe 0,1°','arpege_europe','adapter-present'),
 'arpege/025':('meteofrance_arpege_world025_native','ARPEGE monde 0,25°','arpege_world','longitude-rotation-required'),
}
for region,label,domain in [('ANTIL','Antilles','antilles'),('GUYANE','Guyane','guyane'),('INDIEN','océan Indien','indian_ocean'),('NCALED','Nouvelle-Calédonie','new_caledonia'),('POLYN','Polynésie','polynesia')]:
    known[f'arome-om/{region}/0025']=(f'meteofrance_arome_{domain}_native',f'AROME {label} 0,025°',f'arome_{domain}','adapter-present' if region=='INDIEN' else 'adapter-required')
models={};catalogue=[];evidence=[]
for route,objects in sorted(groups.items()):
    first=objects[0]['key'].rsplit('/',1)[1]
    family,grid,_,_,suffix=first.split('__');extension=suffix.split('Z.',1)[1]
    package_spans=collections.defaultdict(set)
    for obj in objects:
        parts=obj['key'].rsplit('/',1)[1].split('__')
        assert len(parts)==5 and parts[0]==family and parts[1]==grid
        assert parts[-1]==reference+'.'+extension
        package_spans[parts[2]].add(parts[3])
    packages=sorted(package_spans)
    spans=sorted(set().union(*package_spans.values()))
    filename=f'{family}__{grid}__{{package}}__{{span}}__{{referenceTime}}.{extension}'
    prefix='pnt/{referenceTime}/'+route+'/'
    template=prefix+'{package}/'+filename
    if route in known:
        model_id,title,domain,status=known[route]
    else:
        key=re.sub(r'[^a-z0-9]+','_',route.lower()).strip('_')
        model_id='meteofrance_'+key+'_native';domain=key
        title=route.replace('/',' · ')
        status='netcdf-reader-required' if extension=='nc' else 'adapter-required'
    max_hour=None if '999H' in ''.join(spans) else max(int(n) for span in spans for n in re.findall(r'\d+',span))
    prep={'status':status,'catalogueVerified':True,'verifiedReferenceTime':reference,'prefixTemplate':prefix,'objectKeyTemplate':template,'format':extension,'activationRequirements':['Choisir explicitement les variables OM','Valider le domaine et ses transformations sur un GRIB réel']}
    if status!='adapter-present':prep['activationRequirements'].append('Compléter l’adaptateur indiqué par status avant activation')
    if status=='longitude-rotation-required':prep['activationRequirements'].append('La grille globale est refusée par le moteur actuel')
    if extension=='nc':prep['activationRequirements'].append('000H999H est un fichier multi-échéances, pas un horizon de 999 heures')
    ingestion={'provider':'meteofrance-grib','domain':domain,'baseUrl':base,'packages':packages,'variables':[],'workDirectory':'/var/data/meteofrance/grib','gribRetentionHours':6,'downloadConcurrency':1,'downloadTimeoutMs':180000,'unknownFields':'report'}
    if max_hour is not None:ingestion['maxForecastHour']=max_hour
    # Prepared paths are metadata. Unsupported domains still fail before acquisition if enabled accidentally.
    models[model_id]={'name':title,'enabled':False,'managed':True,'checkInterval':'*/5 * * * *','fileExtension':'.om','retentionHours':96,'ingestion':ingestion,'_preparation':prep}
    catalogue.append({'id':model_id,'name':title,'enabled':False,'route':route,'baseUrl':base,'prefixTemplate':prefix,'objectKeyTemplate':template,'packages':packages,'observedSpansByPackage':{p:sorted(s) for p,s in sorted(package_spans.items())},'observedMaxForecastHour':max_hour,'format':extension,'adapterStatus':status})
    for obj in objects:
        parts=obj['key'].rsplit('/',1)[1].split('__')
        assert template.format(referenceTime=reference,package=parts[2],span=parts[3])==obj['key']
    evidence.append({'route':route,'objects':len(objects),'bytes':sum(o['bytes'] for o in objects),'objectsByPackage':dict(collections.Counter(o['key'].split('/')[-2] for o in objects)),'sampleKey':objects[0]['key'],'lastModifiedMin':min(o['lastModified'] for o in objects),'lastModifiedMax':max(o['lastModified'] for o in objects)})
# These are reservations only: never manufacture an OVH URL or silently use an authenticated API.
for domain,title,doc in [
 ('arome_pi_france_0025','AROME PI France 0,025°','https://www.data.gouv.fr/dataservices/api-modele-arome-prevision-immediate'),
 ('arome_pi_france_001','AROME PI France 0,01°','https://www.data.gouv.fr/dataservices/api-modele-arome-prevision-immediate'),
 ('arome_piaf','AROME PIAF','https://www.data.gouv.fr/dataservices/api-modele-arome-prevision-immediate-agregee-fusionnee'),
 ('arome_ensemble','AROME prévision d’ensemble',None),('arpege_ensemble','ARPEGE prévision d’ensemble',None)]:
    model_id='meteofrance_'+domain+'_native'
    prep={'status':'ovh-path-not-found','catalogueVerified':False,'prefixTemplate':None,'objectKeyTemplate':None,'documentationUrl':doc,'activationRequirements':['Trouver et vérifier un chemin OVH publié','Implémenter et valider l’adaptateur','Choisir les variables']}
    models[model_id]={'name':title,'enabled':False,'managed':True,'checkInterval':'*/5 * * * *','fileExtension':'.om','retentionHours':96,'ingestion':{'provider':'meteofrance-grib','domain':domain,'baseUrl':None,'packages':[],'variables':[]},'_preparation':prep}
    catalogue.append({'id':model_id,'name':title,'enabled':False,'baseUrl':None,'prefixTemplate':None,'objectKeyTemplate':None,'adapterStatus':'ovh-path-not-found','documentationUrl':doc})
(CONFIG/'meteofrance-ovh.catalogue.json').write_text(json.dumps({'schemaVersion':1,'baseUrl':base,'observedAt':snapshot['observedAt'],'referenceTimeInspected':reference,'notes':['Métadonnées publiques uniquement ; aucun GRIB ni NetCDF téléchargé','Une présence au catalogue ne prouve pas la complétude du run','Les chemins préparés ne sont pas encore consommés par un adaptateur générique','Les champs _preparation sont documentaires ; les domaines hors liste actuelle demandent une extension du code'],'models':catalogue},indent=2,ensure_ascii=False)+'\n')
(CONFIG/'catalogue/ovh-evidence-20261119.json').write_text(json.dumps({'baseUrl':base,'observedAt':snapshot['observedAt'],'referenceTime':reference,'catalogueSha256':hashlib.sha256(snapshot_path.read_bytes()).hexdigest(),'routes':evidence},indent=2,ensure_ascii=False)+'\n')
assert all(m['enabled'] is False for m in models.values())
print(f'{len(groups)} chemins OVH vérifiés ; {len(models)-len(groups)} réservations sans URL ; toutes les entrées désactivées.')
