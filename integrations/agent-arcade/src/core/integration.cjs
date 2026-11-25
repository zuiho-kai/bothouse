'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { EVENTS } = require('./events.cjs');
const { atomicJSON } = require('./files.cjs');
const MARKER = 'Agent Arcade observer';
function loadSettings(file) {
  if (!fs.existsSync(file)) return {};
  const data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.hooks && (typeof data.hooks !== 'object' || Array.isArray(data.hooks)))) throw Error('Invalid Claude settings; no changes made.');
  return data;
}
function strip(settings) {
  const copy = structuredClone(settings);
  for (const key of Object.keys(copy.hooks || {})) {
    if (!Array.isArray(copy.hooks[key])) throw Error('Invalid hook configuration; no changes made.');
    copy.hooks[key] = copy.hooks[key].map(group => ({ ...group, hooks: (group.hooks || []).filter(h => h.statusMessage !== MARKER) })).filter(group => group.hooks.length);
    if (!copy.hooks[key].length) delete copy.hooks[key];
  }
  return copy;
}
function install({ settingsFile, root, sourceDir, nodePath = 'node' }) {
  const original = loadSettings(settingsFile);
  const settings = strip(original);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(path.join(bin, 'core'), { recursive: true, mode: 0o700 });
  fs.copyFileSync(path.join(sourceDir, 'hook.cjs'), path.join(bin, 'hook.cjs'));
  for (const f of ['events.cjs','files.cjs']) fs.copyFileSync(path.join(sourceDir, 'core', f), path.join(bin, 'core', f));
  // Exec-form hooks bypass shell quoting entirely (Claude Code >= 2.1.207).
  const command = nodePath;
  settings.hooks ||= {};
  for (const event of EVENTS) (settings.hooks[event] ||= []).push({ hooks: [{ type: 'command', command, args: [path.join(bin, 'hook.cjs')], timeout: 2, statusMessage: MARKER }] });
  const backup = fs.existsSync(settingsFile) ? `${settingsFile}.arcade-${Date.now()}.bak` : null;
  if (backup) fs.copyFileSync(settingsFile, backup);
  atomicJSON(settingsFile, settings);
  return { backup, settingsFile };
}
function uninstall(settingsFile) {
  const settings = loadSettings(settingsFile);
  if (!fs.existsSync(settingsFile)) return;
  fs.copyFileSync(settingsFile, `${settingsFile}.arcade-${Date.now()}.bak`);
  atomicJSON(settingsFile, strip(settings));
}
function installed(settingsFile) {
  try { const s = loadSettings(settingsFile); return EVENTS.every(e => s.hooks?.[e]?.some(g => g.hooks?.some(h => h.statusMessage === MARKER))); } catch { return false; }
}
module.exports = { install, uninstall, installed, strip, MARKER };
