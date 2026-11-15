// Extrae del bundle los dos AudioWorklet del cliente de ElevenLabs y los guarda como archivos de la extensión.
// Motivo: el cliente los carga por defecto desde un blob:, y la CSP de las extensiones MV3 lo bloquea.
// Al sacarlos del propio bundle, el nombre/versión del worklet siempre coincide con la librería instalada.
import fs from 'node:fs';
const dir = 'dist/assets';
const bundle = fs.readdirSync(dir).filter((f) => /^sidepanel-.*\.js$/.test(f));
let code = '';
for (const f of bundle) code += fs.readFileSync(`${dir}/${f}`, 'utf8');
fs.mkdirSync('dist/worklets', { recursive: true });
for (const n of ['rawAudioProcessor', 'audioConcatProcessor']) {
  const m = new RegExp(`\\("${n}","[0-9a-f]+",\``).exec(code);
  if (!m) throw new Error(`No se encontró el worklet ${n} en el bundle`);
  const start = m.index + m[0].length;
  let i = start;
  while (!(code[i] === '`' && code[i - 1] !== '\\')) i++;
  const src = eval('`' + code.slice(start, i) + '`');
  if (!/registerProcessor\("/.test(src)) throw new Error(`Worklet ${n} inválido`);
  fs.writeFileSync(`dist/worklets/${n}.js`, src);
  console.log('worklet', n, src.length);
}
