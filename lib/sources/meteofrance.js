// Source discovery belongs to the acquisition library, never to the GRIB converter.
const base = 'https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/';
const decode = s => s.replace(/&(?:amp|lt|gt|quot|apos);/g, v => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[v]));
function tag(xml, name) { return decode(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] ?? ''); }
function parseListing(xml) {
  if (!xml.includes('<ListBucketResult')) throw new Error('Invalid Météo-France S3 catalogue');
  const files = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(match => {
    const key = tag(match[1], 'Key'), bytes = Number(tag(match[1], 'Size'));
    if (!key || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('Invalid catalogue object');
    return { key, bytes, etag: tag(match[1], 'ETag').replaceAll('"', '') };
  });
  const token = tag(xml, 'NextContinuationToken');
  if (tag(xml, 'IsTruncated') === 'true' && !token) throw new Error('Truncated catalogue without continuation token');
  return { files, token };
}
function sourceLayout(config) {
  if (!['arome_france', 'arome_france_hd', 'arpege_europe', 'arome_indian_ocean'].includes(config.domain)) throw new Error('Unsupported Météo-France domain');
  if (!Array.isArray(config.packages) || !config.packages.length || new Set(config.packages).size !== config.packages.length || config.packages.some(p => !/^(SP[1-3]|HP[1-3]|IP[1-5])$/.test(p))) throw new Error('Invalid GRIB package selection');
  const overseas = config.domain === 'arome_indian_ocean';
  const maximum = overseas ? 48 : config.domain === 'arpege_europe' ? 102 : 51;
  if (!Number.isInteger(config.maxForecastHour) || config.maxForecastHour < 0 || config.maxForecastHour > maximum) throw new Error('Invalid forecast horizon');
  const hourly = overseas || config.domain === 'arome_france_hd';
  const family = overseas ? 'arome-om' : config.domain === 'arpege_europe' ? 'arpege' : 'arome';
  const grid = overseas ? 'INDIEN/0025' : hourly ? '001' : family === 'arome' ? '0025' : '01';
  const spans = hourly ? Array.from({ length: config.maxForecastHour + 1 }, (_, h) => `${String(h).padStart(overseas ? 3 : 2, '0')}H`) : family === 'arome' ? ['00H06H', '07H12H', '13H18H', '19H24H', '25H30H', '31H36H', '37H42H', '43H48H', '49H51H'] : ['000H012H', '013H024H', '025H036H', '037H048H', '049H060H', '061H072H', '073H084H', '085H096H', '097H102H'];
  const dimensions = overseas ? [899, 1395] : config.domain === 'arome_france_hd' ? [1791, 2801] : config.domain === 'arome_france' ? [717, 1121] : [521, 741];
  return { dimensions, family, grid, fileFamily: overseas ? 'arome-om-INDIEN' : family, fileGrid: overseas ? '0025' : grid, spans: spans.filter(s => parseInt(s, 10) <= config.maxForecastHour), cadence: family === 'arome' ? 3 : 6 };
}
async function discoverRun(config, now = Date.now(), fetcher = fetch) {
  const layout = sourceLayout(config), lag = config.publicationLagHours ?? 3;
  if (!Number.isFinite(lag) || lag < 0 || lag > 24) throw new Error('Invalid publication lag');
  const hour = 3600000;
  const referenceTime = config.referenceTime ?? new Date(Math.floor((now - lag * hour) / (layout.cadence * hour)) * layout.cadence * hour).toISOString().replace('.000Z', 'Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/.test(referenceTime) || !Number.isFinite(Date.parse(referenceTime)) || new Date(referenceTime).toISOString().replace('.000Z', 'Z') !== referenceTime) throw new Error('Invalid run reference time');
  const prefix = `pnt/${referenceTime}/${layout.family}/${layout.grid}/`, root = new URL(config.baseUrl ?? base);
  if (!['http:', 'https:'].includes(root.protocol)) throw new Error('HTTP(S) source required');
  const objects = new Map(), seen = new Set(); let token = '';
  do {
    const url = new URL(root); url.search = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) }).toString();
    const response = await fetcher(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Météo-France catalogue HTTP ${response.status}`);
    const listing = parseListing(await response.text());
    for (const file of listing.files) if (file.key.startsWith(prefix)) objects.set(file.key, file);
    token = listing.token;
    if (token && seen.has(token)) throw new Error('Repeated catalogue pagination token');
    seen.add(token);
  } while (token);
  const files = [], missing = [];
  for (const span of layout.spans) for (const pkg of config.packages) {
    if (config.domain === 'arome_indian_ocean' && span === '000H' && ['HP3', 'IP4'].includes(pkg)) continue;
    const name = `${layout.fileFamily}__${layout.fileGrid}__${pkg}__${span}__${referenceTime}.grib2`, key = `${prefix}${pkg}/${name}`;
    const object = objects.get(key);
    if (!object) missing.push(name); else files.push({ name, url: new URL(key, root).toString(), bytes: object.bytes, etag: object.etag });
  }
  return { referenceTime, files, missing, validTimes: Array.from({ length: config.maxForecastHour + 1 }, (_, h) => new Date(Date.parse(referenceTime) + h * hour).toISOString().replace('.000Z', 'Z')) };
}
module.exports = { discover: discoverRun, discoverRun, sourceLayout, parseListing };
