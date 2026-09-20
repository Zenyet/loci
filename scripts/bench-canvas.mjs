import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createServer } from 'vite';

// Uses an isolated Chrome profile and Node 22's WebSocket; no test dependency.
const chromePath = process.env.CHROME_PATH || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const output = process.env.BENCH_OUTPUT;
const runs = Math.max(1, Math.min(10, Number(process.env.BENCH_RUNS) || 1));
const baseline = process.argv.includes('--baseline');
const baselineRef = process.env.BENCH_BASELINE_REF || 'HEAD';
const baselineSource = baseline ? execFileSync('git', ['show', `${baselineRef}:src/designs/Graph/render.ts`], { encoding: 'utf8' }) : null;
const profile = await mkdtemp(join(tmpdir(), 'loci-canvas-bench-'));
const server = await createServer({ appType: 'custom', server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: baseline ? [{ name: 'canvas-baseline', enforce: 'pre', transform(_code, id) {
    if (id.endsWith('/src/designs/Graph/render.ts')) return baselineSource;
  } }] : [],
});
server.middlewares.use('/__canvas_bench', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<html><body><script type="module" src="/scripts/bench-canvas.ts"></script></body></html>');
});
await server.listen();
const port = server.httpServer.address().port;
const chrome = spawn(chromePath, [
  ...process.argv.includes('--headed') ? [] : ['--headless=new'],
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--no-first-run',
  '--no-default-browser-check', '--disable-extensions', '--window-size=1440,900',
  '--force-device-scale-factor=2', 'about:blank',
], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
// macOS exposes device-wide GPU activity without privileged power sampling.
// This includes other apps; it is deliberately not attributed to the tab.
async function deviceGpuUsage() {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync('/usr/sbin/ioreg', ['-r', '-c', 'AGXAccelerator', '-a']);
    const match = /<key>Device Utilization %<\/key>\s*<integer>(\d+)<\/integer>/.exec(stdout);
    return match ? Number(match[1]) : null;
  } catch { return null; }
}
let launchError;
chrome.on('error', error => { launchError = error; });
let socket;
try {
  let endpoint;
  for (let i = 0; i < 100; i++) {
    if (launchError) throw launchError;
    try {
      const [debugPort, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
      endpoint = `ws://127.0.0.1:${debugPort}${path}`;
      break;
    } catch { await delay(100); }
  }
  if (!endpoint) throw new Error('Chrome did not expose a debugging endpoint. Set CHROME_PATH if needed.');
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    clearTimeout(call.timer);
    if (message.error) call.reject(new Error(JSON.stringify(message.error)));
    else call.resolve(message.result);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const system = await send('SystemInfo.getInfo');
  const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${port}/__canvas_bench` });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async expression => {
    const value = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (value.exceptionDetails) throw new Error(JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  let ready = false;
  for (let i = 0; i < 100; i++) {
    ready = await evaluate('typeof window.runScenario === "function"');
    if (ready) break;
    await delay(100);
  }
  if (!ready) throw new Error('Canvas benchmark module did not load.');
  const refresh = await evaluate('window.calibrate()');
  await send('Performance.enable', {}, sessionId);
  const metrics = async () => Object.fromEntries((await send('Performance.getMetrics', {}, sessionId)).metrics.map(m => [m.name, m.value]));
  const results = [];
  const physics = [];
  for (let run = 1; run <= runs; run++) for (const count of [100, 500, 2000]) {
    await evaluate(`window.prepareScenario(${count})`);
    const before = await metrics();
    const processesBefore = await send('SystemInfo.getProcessInfo');
    const gpuSamples = [];
    const sampleGpu = async () => { const value = await deviceGpuUsage(); if (value !== null) gpuSamples.push(value); };
    const sampler = process.platform === 'darwin' ? setInterval(sampleGpu, 250) : null;
    let result;
    try { result = await evaluate('window.runScenario()'); }
    finally { if (sampler) clearInterval(sampler); }
    result.run = run;
    const processesAfter = await send('SystemInfo.getProcessInfo');
    const after = await metrics();
    const seconds = after.Timestamp - before.Timestamp;
    result.rendererMainCpuPercent = (after.TaskDuration - before.TaskDuration) / seconds * 100;
    result.gpuProcessCpuPercent = processesAfter.processInfo.filter(p => p.type === 'GPU').reduce((sum, p) => sum + p.cpuTime - (processesBefore.processInfo.find(b => b.id === p.id)?.cpuTime ?? p.cpuTime), 0) / seconds * 100;
    result.deviceGpuPercent = gpuSamples.length ? {
      mean: gpuSamples.reduce((sum, n) => sum + n, 0) / gpuSamples.length,
      max: Math.max(...gpuSamples), samples: gpuSamples.length,
    } : null;
    results.push(result);
    console.log(JSON.stringify(result));
    if (run === runs) physics.push(await evaluate('window.runSimulationBenchmark()'));
  }
  const report = { date: new Date().toISOString(), baseline, baselineRef: baseline ? baselineRef : null,
    mode: process.argv.includes('--headed') ? 'headed' : 'headless', refresh,
    browser: await send('Browser.getVersion'), gpu: system.gpu, results, physics };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ refresh, physics, gpu: system.gpu.devices, features: system.gpu.featureStatus }));
} finally {
  socket?.close();
  chrome.kill();
  await server.close();
  await new Promise(resolve => chrome.exitCode !== null || !chrome.pid ? resolve() : chrome.once('exit', resolve));
  await rm(profile, { recursive: true, force: true });
}
