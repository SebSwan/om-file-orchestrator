function formatTimestampKey(ms) {
  const iso = new Date(ms).toISOString(); // 2026-09-16T14:00:00.000Z
  return `${iso.slice(0, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

function parseTimestampKey(key) {
  const m = key.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(?:\.om)?$/);
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`) : NaN;
}

function runFromPath(file) {
  const m = file.match(/\/(\d{4})\/(\d{2})\/(\d{2})\/(\d{2})(\d{2})Z\//);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null;
}
module.exports = {formatTimestampKey, parseTimestampKey, runFromPath};
