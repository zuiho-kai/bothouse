'use strict';
// Compiles the host simulator of the desk robot's firmware core
// (hardware/pet-robot/sim) into a temporary folder. Used by the unit tests and
// by scripts/pet-robot-smoke.cjs. Returns {binary, dispose} or {skip: reason}.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), {spawnSync} = require('node:child_process');

const hardware = path.resolve(__dirname, '..', '..', 'hardware', 'pet-robot');
const FLAGS = ['-std=c++17', '-O1', '-g', '-Wall', '-Wextra', '-Wpedantic', '-Wconversion', '-Wshadow', '-Werror'];

// Embed the same binary files a board port would map from flash. The host
// executable can then cold-boot in a directory with no art or app installed.
function writeSleepAssets(out) {
  const arrays = [];
  for (const [name, file] of [['lcdSleep', 'ju-lcd-320x240.aaps'], ['portraitSleep', 'ju-portrait-480.aaps']]) {
    const bytes = fs.readFileSync(path.join(hardware, 'firmware', 'assets', file));
    const lines = [];
    for (let i = 0; i < bytes.length; i += 64) lines.push(bytes.subarray(i, i + 64).join(','));
    arrays.push(`static constexpr uint8_t ${name}[] = {\n${lines.join(',\n')}\n};\n`);
  }
  fs.writeFileSync(path.join(out, 'aap-sleep-assets.h'), arrays.join('\n'));
}

function buildSimulator({standalone = false} = {}) {
  const compiler = ['c++', 'clang++', 'g++'].find(name => spawnSync(name, ['--version'], {encoding: 'utf8'}).status === 0);
  if (!compiler) return {skip: 'no C++ compiler on this machine'};
  const flags = [...FLAGS];
  const standaloneWindows = standalone && process.platform === 'win32';
  if (standaloneWindows) {
    const target = spawnSync(compiler, ['-dumpmachine'], {encoding: 'utf8'});
    if (target.status !== 0) throw Error('Cannot determine the Windows C++ runtime for the standalone simulator');
    if (/mingw|windows-gnu/i.test(target.stdout)) flags.push('-static');
    else if (/windows-msvc/i.test(target.stdout)) flags.push('-fms-runtime-lib=static');
    else throw Error(`Unsupported standalone Windows compiler target: ${target.stdout.trim()}`);
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aap-sim-')), binary = path.join(out, process.platform === 'win32' ? 'aap-sim.exe' : 'aap-sim');
  try { writeSleepAssets(out); } catch (error) { fs.rmSync(out, {recursive: true, force: true}); throw error; }
  const sources = ['-DAAP_SIM_BUILTIN_SLEEP', '-I', out, path.join(hardware, 'core', 'aap.cpp'), path.join(hardware, 'sim', 'main.cpp')];
  // Developer tests use sanitizers where available. A standalone Windows
  // executable must also run without the compiler's sanitizer or runtime DLLs.
  const compile = extra => spawnSync(compiler, [...flags, ...extra, ...sources, '-o', binary], {encoding: 'utf8'});
  let sanitized = !standaloneWindows;
  let built = compile(sanitized ? ['-fsanitize=address,undefined', '-fno-sanitize-recover=all'] : []);
  if (sanitized && built.status !== 0 && /sanitize|asan|ubsan/i.test(built.stderr)) { built = compile([]); sanitized = false; }
  if (built.status !== 0) { fs.rmSync(out, {recursive: true, force: true}); throw Error(`The firmware core does not compile:\n${built.stderr}`); }
  return {binary, compiler, sanitized, dispose: () => fs.rmSync(out, {recursive: true, force: true})};
}

module.exports = {buildSimulator, hardware, FLAGS};

if (require.main === module) {
  const destination = process.argv[2];
  if (!destination || process.argv.length !== 3) {
    console.error('Usage: node scripts/pets/build-sim.cjs <output executable>');
    process.exitCode = 2;
  } else {
    const built = buildSimulator({standalone: true});
    if (built.skip) throw Error(built.skip);
    try { fs.copyFileSync(built.binary, destination); } finally { built.dispose(); }
    console.log(path.resolve(destination));
  }
}
