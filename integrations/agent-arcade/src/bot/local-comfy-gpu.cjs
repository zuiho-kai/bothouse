'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const exec = promisify(execFile);

const minFreeMiB = 18000;
const activityLimit = 10;

function gpuState(samples, { requireFreeMemory = true } = {}) {
  if (samples.length !== 3 || samples.some(sample => !sample)) return 'unavailable';
  if (samples.filter(({ gpu, memory }) => gpu > activityLimit || memory > activityLimit).length >= 2) {
    return 'busy';
  }
  return !requireFreeMemory || samples.every(({ free }) => free >= minFreeMiB) ? 'idle' : 'unavailable';
}

function sampleFromCsv(output) {
  const match = /^(\d+),\s*(\d+),\s*(\d+)$/u.exec(output.trim());
  if (!match) return null;
  const [, gpu, memory, free] = match.map(Number);
  return gpu <= 100 && memory <= 100 ? { gpu, memory, free } : null;
}

async function sampleLocalGpu(signal, options) {
  const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32/nvidia-smi.exe');
  const samples = [];
  for (let index = 0; index < 3; index++) {
    signal.throwIfAborted();
    try {
      // Device-wide engine and memory activity cover rendering and compute.
      // WDDM process listings also contain ordinary desktop programs.
      const { stdout } = await exec(executable, [
        '--query-gpu=utilization.gpu,utilization.memory,memory.free', '--format=csv,noheader,nounits',
      ], { windowsHide: true, timeout: 2500, signal });
      samples.push(sampleFromCsv(stdout));
    } catch {
      signal.throwIfAborted();
      return 'unavailable';
    }
    if (index < 2) await delay(400, undefined, { signal });
  }
  return gpuState(samples, options);
}

module.exports = { sampleLocalGpu, sampleFromCsv, gpuState };
