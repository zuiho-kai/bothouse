'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { atomicJSON, readJSON } = require('../core/files.cjs');
const exec = promisify(execFile);
const { sampleLocalGpu } = require('./local-comfy-gpu.cjs');

const host = '127.0.0.1';
const port = 8188;
const system = path.join(process.env.SystemRoot || 'C:/Windows', 'System32');
const settingsFile = 'local-comfy-installation.json';
const failure = code => Object.assign(new Error(code), { code });

function approvedFile(file, name) {
  if (typeof file !== 'string' || !/^[a-z]:[\\/]/i.test(file) ||
      path.win32.basename(file).toLowerCase() !== name) throw failure('local_drawing_installation_invalid');
  const real = fs.realpathSync(file);
  if (!/^[a-z]:[\\/]/i.test(real) || !fs.statSync(real).isFile()) throw failure('local_drawing_installation_invalid');
  return real;
}

function validateInstall(value) {
  try {
    const main = approvedFile(value?.main, 'main.py');
    const python = approvedFile(value?.python, 'python.exe');
    const source = path.dirname(main);
    const pythonDir = path.dirname(python);
    const models = path.join(source, 'models');
    const frontend = path.join(pythonDir, 'Lib/site-packages/comfyui_frontend_package/static');
    for (const file of [path.join(source, 'comfy/cli_args.py'), path.join(frontend, 'index.html')]) {
      if (!fs.statSync(file).isFile()) throw failure('local_drawing_installation_invalid');
    }
    if (!fs.statSync(models).isDirectory() || fs.existsSync(path.join(source, 'extra_model_paths.yaml'))) {
      throw failure('local_drawing_installation_invalid');
    }
    return { main, python, pythonDir, models, frontend };
  } catch {
    throw failure('local_drawing_installation_invalid');
  }
}

function parseListeners(table) {
  const listeners = [];
  for (const line of table.split(/\r?\n/u)) {
    const [protocol, local, peer, ...tail] = line.trim().split(/\s+/u);
    if (protocol !== 'TCP' || !local?.endsWith(':' + port)) continue;
    if (!peer || tail.length < 2 || !/^\d+$/u.test(tail.at(-1))) throw failure('local_drawing_offline');
    if (peer !== '0.0.0.0:0' && peer !== '[::]:0' && tail[0] !== 'LISTENING') continue;
    listeners.push({ address: local.slice(0, local.lastIndexOf(':')).replace(/^\[|\]$/gu, ''),
      pid: Number(tail.at(-1)) });
  }
  return listeners;
}

async function listeners(signal) {
  const tables = await Promise.all(['tcp', 'tcpv6'].map(protocol =>
    exec(path.join(system, 'netstat.exe'), ['-a', '-n', '-o', '-p', protocol],
      { windowsHide: true, timeout: 6000, signal })));
  return tables.flatMap(({ stdout }) => parseListeners(stdout));
}

async function checkGpu(signal, options) {
  const state = await sampleLocalGpu(signal, options);
  if (state === 'busy') throw failure('local_drawing_busy');
  if (state !== 'idle') throw failure('local_drawing_gpu_unavailable');
}

async function probe(signal) {
  const active = AbortSignal.any([signal, AbortSignal.timeout(2200)]);
  let response;
  try {
    response = await fetch('http://' + host + ':' + port + '/queue', {
      signal: active, redirect: 'error', credentials: 'omit', cache: 'no-store',
    });
  } catch (error) {
    signal.throwIfAborted();
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw failure('local_drawing_offline');
  }
  // Busy services are reused too. The existing provider handles queue waiting.
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('application/json')) {
    await response.body?.cancel().catch(()=>{});
    throw failure('local_drawing_offline');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 512 * 1024) throw failure('local_drawing_offline');
    chunks.push(chunk);
  }
  const queue = JSON.parse(Buffer.concat(chunks, size));
  if (!Array.isArray(queue?.queue_running) || !Array.isArray(queue.queue_pending)) throw failure('local_drawing_offline');
  return true;
}

function argumentsFor(install, run) {
  return ['-E', '-s', '-B', '-u', install.main,
    '--listen', host, '--port', String(port), '--base-directory', run, '--models-directory', install.models,
    '--user-directory', path.join(run, 'user'), '--input-directory', path.join(run, 'input'),
    '--output-directory', path.join(run, 'output'), '--temp-directory', path.join(run, 'temp'),
    '--database-url', 'sqlite:///' + path.join(run, 'comfy.db').replaceAll('\\', '/'),
    '--front-end-root', install.frontend, '--disable-auto-launch', '--disable-all-custom-nodes',
    '--disable-api-nodes', '--disable-pinned-memory', '--disable-metadata'];
}

function start(install, root) {
  const runtime = path.join(root, 'local-comfy-runtime');
  fs.mkdirSync(runtime, { recursive: true });
  const run = fs.mkdtempSync(path.join(runtime, 'service-'));
  for (const name of ['user', 'input', 'output', 'temp']) fs.mkdirSync(path.join(run, name));
  const temp = path.join(run, 'temp');
  const log = fs.openSync(path.join(run, 'comfy-console.log'), 'wx');
  let child;
  try {
    child = spawn(install.python, argumentsFor(install, run), {
      cwd: run, windowsHide: true, stdio: ['ignore', log, log],
      env: {
        SystemRoot: process.env.SystemRoot || 'C:/Windows', WINDIR: process.env.WINDIR || 'C:/Windows',
        USERPROFILE: run, APPDATA: run, LOCALAPPDATA: run,
        PATH: [install.pythonDir, path.join(install.pythonDir, 'Library/bin'), path.join(install.pythonDir, 'Scripts'), system].join(path.delimiter),
        TEMP: temp, TMP: temp, HF_HOME: temp, XDG_CACHE_HOME: temp, TORCH_HOME: temp, CUDA_CACHE_PATH: temp,
        HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
      },
    });
  } finally {
    fs.closeSync(log);
  }
  let exited = false;
  const finished = new Promise(resolve => {
    child.once('exit', () => { exited = true; resolve(); });
    child.on('error', () => {
      if (!child.pid) { exited = true; resolve(); }
    });
  });
  const alive = () => !!child.pid && !exited && child.exitCode === null && child.signalCode === null;
  return {
    pid: child.pid, alive,
    async close() {
      // Retain the original process handle; never look up a process to terminate by PID.
      if (alive() && !child.killed && !child.kill('SIGTERM') && alive()) throw failure('local_drawing_cleanup_unconfirmed');
      await Promise.race([finished, delay(5000, null, { ref: false }).then(() => {
        throw failure('local_drawing_cleanup_unconfirmed');
      })]);
    },
  };
}

class LocalComfyRuntime {
  constructor({ root, platform = process.platform, inspect = validateInstall, serviceOnline = probe,
    portOwners = listeners, gpuAvailable = checkGpu, startService = start }) {
    Object.assign(this, { root, platform, inspect, serviceOnline, portOwners, gpuAvailable, startService });
    this.file = path.join(root, settingsFile);
    this.lifetime = new AbortController();
    this.child = null;
    this.starting = null;
  }

  status() {
    return { supported: this.platform === 'win32', configured: !!readJSON(this.file, null) };
  }

  configure(selection, { onlyIfUnset = false } = {}) {
    this.lifetime.signal.throwIfAborted();
    if (this.platform !== 'win32') throw failure('local_drawing_installation_invalid');
    const { main, python } = this.inspect(selection);
    if (!onlyIfUnset) {
      atomicJSON(this.file, { main, python });
      return this.status();
    }
    // Personal-release preparation must preserve even an explicit opt-out.
    const staged = this.file + '.' + randomUUID() + '.provision';
    atomicJSON(staged, { main, python });
    try {
      fs.linkSync(staged, this.file);
      return { ...this.status(), provisioned: true };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return { ...this.status(), provisioned: false };
    } finally {
      fs.unlinkSync(staged);
    }
  }

  forget() {
    this.lifetime.signal.throwIfAborted();
    atomicJSON(this.file, null);
    return this.status();
  }

  async ensure({ signal, assertCurrent }) {
    const active = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal;
    const check = () => { active.throwIfAborted(); assertCurrent(); active.throwIfAborted(); };
    check();
    // A request that arrives during abandoned startup cleanup can retry after
    // that attempt settles. It must not revive it or start a second child.
    while (this.starting && (!this.starting.accepting || this.starting.controller.signal.aborted)) {
      const cancelled = Promise.withResolvers();
      const abort = () => cancelled.reject(active.reason);
      active.addEventListener('abort', abort, { once: true });
      try {
        await Promise.race([this.starting.finished, cancelled.promise]);
      } finally {
        active.removeEventListener('abort', abort);
      }
      check();
    }
    if (!this.starting) {
      const attempt = { controller: new AbortController(), waiters: new Set(), child: null, accepting: true };
      this.starting = attempt;
      attempt.finished = Promise.resolve().then(() => this.runStartup(attempt))
        .finally(() => { this.starting = null; });
    }

    const attempt = this.starting;
    const result = Promise.withResolvers();
    const detach = () => {
      active.removeEventListener('abort', abort);
      attempt.waiters.delete(waiter);
    };
    const abort = () => waiter.cancel(active.reason);
    const waiter = {
      check,
      ready: child => {
        detach();
        // The caller checks a warm child once the shared ComfyUI queue is idle.
        result.resolve(child && (() => this.#checkManagedGpu(child, active, check)));
      },
      fail(error) { detach(); result.reject(error); },
      cancel(error) {
        detach();
        if (attempt.waiters.size) {
          result.reject(error);
        } else {
          attempt.controller.abort();
          // For the last waiter, finish releasing its process before returning.
          void attempt.finished.then(() => result.reject(error), () => result.reject(error));
        }
      },
    };
    attempt.waiters.add(waiter);
    active.addEventListener('abort', abort, { once: true });
    return result.promise;
  }

  async runStartup(attempt) {
    const signal = attempt.controller.signal;
    const check = () => {
      signal.throwIfAborted();
      for (const waiter of attempt.waiters) {
        try { waiter.check(); }
        catch (error) { waiter.cancel(error); }
      }
      signal.throwIfAborted();
    };
    try {
      check();
      const warmChild = await this.ensureService(attempt, check);
      check();
      attempt.accepting = false;
      for (const waiter of attempt.waiters) waiter.ready(warmChild);
    } catch (error) {
      attempt.accepting = false;
      let result = error?.code?.startsWith?.('local_drawing_') ? error : failure('local_drawing_offline');
      if (attempt.child) {
        try {
          await attempt.child.close();
          this.child = null;
        } catch {
          // Keep the original child handle for App Quit to retry cleanup.
          result = failure('local_drawing_cleanup_unconfirmed');
        }
      }
      for (const waiter of attempt.waiters) {
        try { waiter.check(); }
        catch (error) { waiter.cancel(error); continue; }
        waiter.fail(result);
      }
    }
  }

  async #assertOwnedListener(child, signal, check) {
    const owners = await this.portOwners(signal);
    check();
    if (!child.alive() || owners.length !== 1 || owners[0].address !== host || owners[0].pid !== child.pid) {
      throw failure('local_drawing_offline');
    }
  }

  async #checkManagedGpu(child, signal, check) {
    check();
    await this.#assertOwnedListener(child, signal, check);
    // A retained model consumes VRAM while idle. Recheck GPU activity on
    // each managed reuse, without applying the fresh-start memory floor.
    await this.gpuAvailable(signal, { requireFreeMemory: false });
    check();
    await this.#assertOwnedListener(child, signal, check);
  }

  async ensureService(attempt, check) {
    const signal = attempt.controller.signal;
    if (await this.serviceOnline(signal)) return this.child?.alive() ? this.child : undefined;
    check();
    const selected = readJSON(this.file, null);
    if (!selected || this.platform !== 'win32') throw failure('local_drawing_offline');
    if (this.child?.alive() || (await this.portOwners(signal)).length) throw failure('local_drawing_offline');
    const install = this.inspect(selected);
    await this.gpuAvailable(signal);
    check();
    if (await this.serviceOnline(signal)) return;
    if ((await this.portOwners(signal)).length) throw failure('local_drawing_offline');
    check();
    if (JSON.stringify(selected) !== JSON.stringify(readJSON(this.file, null))) throw failure('local_drawing_offline');

    const child = this.child = attempt.child = this.startService(install, this.root);
    while (child.alive()) {
      check();
      if (await this.serviceOnline(signal)) {
        await this.#assertOwnedListener(child, signal, check);
        return;
      }
      await delay(300, undefined, { signal });
    }
    throw failure('local_drawing_offline');
  }

  async close() {
    this.lifetime.abort();
    await this.starting?.finished;
    await this.child?.close();
    this.child = null;
  }
}

module.exports = { LocalComfyRuntime, validateInstall };
