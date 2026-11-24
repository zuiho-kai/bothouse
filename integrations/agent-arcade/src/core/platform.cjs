'use strict';
// Host-platform decisions in one place. Every function takes the platform (and
// the environment, home directory and file probe) as arguments, so a test on
// one operating system can exercise the answers for another.
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const PLATFORMS = Object.freeze(['win32', 'darwin', 'linux']);
const pathFor = platform => platform === 'win32' ? nodePath.win32 : nodePath.posix;
const isWindows = (platform = process.platform) => platform === 'win32';
const isMac = (platform = process.platform) => platform === 'darwin';
const isLinux = (platform = process.platform) => platform === 'linux';
// The label shown next to a shortcut key. The key handling itself accepts the
// same modifier (Command on macOS, Control elsewhere).
const modifierLabel = (platform = process.platform) => platform === 'darwin' ? '⌘' : 'Ctrl';
const modifierKeyName = (platform = process.platform) => platform === 'darwin' ? 'Meta' : 'Control';

// Optional features implemented only with Windows facilities. The reason is a
// plain sentence the interface or a log may show; it is not a promise of a port.
const WINDOWS_ONLY = Object.freeze({
  managedQQ: 'Managing a local NapCat/QQ installation inspects processes through Windows PowerShell and expects Windows program paths.',
  qqRemoteManagement: 'Remote NapCat management, transfers and the supervisor are part of the Windows QQ accounts page.',
  qce: 'QQ Chat Exporter management depends on the managed Windows QQ runtime.',
  ssqqClient: 'The SSQQ client view depends on the managed Windows QQ runtime.',
  windowsSpeech: 'System speech uses the Windows System.Speech host; no speech backend exists for this platform yet.',
  passkeyHelper: 'The passkey helper calls the Windows WebAuthn API.',
  nativeTerminal: 'Opening and verifying a visible Claude Code terminal uses Windows PowerShell. Copy the command and run it in your own terminal instead.',
  providerLoginWindow: 'Opening the provider sign-in window uses Windows PowerShell. Sign in from your own terminal instead.',
});
function capabilities({platform = process.platform} = {}) {
  const windows = platform === 'win32', features = {};
  for (const [name, reason] of Object.entries(WINDOWS_ONLY)) features[name] = Object.freeze(windows ? {available: true} : {available: false, reason});
  return Object.freeze({platform, modifier: modifierLabel(platform), features: Object.freeze(features)});
}
// IPC channels that exist only for the Windows QQ management layer. The plain
// OneBot connection (botQQ*, botConfigure, botConnect) is not one of them.
const windowsOnlyChannel = channel => typeof channel === 'string' && /^qq[A-Z]/.test(channel);
const UNSUPPORTED = Object.freeze({ok: false, code: 'unsupported_platform'});
const unsupportedResult = () => ({...UNSUPPORTED});

// Window and application lifecycle differences. Windows and Linux keep the
// behaviour the app always had; macOS follows its own conventions.
function lifecycle({platform = process.platform} = {}) {
  const mac = platform === 'darwin';
  return Object.freeze({
    // macOS keeps an application running with no window; the Dock icon reopens it.
    quitWhenAllWindowsClosed: !mac,
    // Without a tray icon, closing the window on macOS still only hides it.
    closeHidesWindowWithoutTray: mac,
    showWindowOnActivate: mac,
    // AppUserModelID is a Windows taskbar and notification concept.
    appUserModelId: platform === 'win32',
    // Without an application menu macOS has no Edit menu, and Command+C/V/X/A stop working in text fields.
    standardApplicationMenu: mac,
    // The menu bar is 22pt high: an 18pt image with a 2x representation.
    trayIconSize: mac ? 18 : 32,
    trayIconRetina: mac,
    dockIcon: mac,
  });
}

// Environment names a child process needs from the operating system. Nothing
// here is a credential. Windows names are the list the app has always used.
const WINDOWS_ENVIRONMENT = Object.freeze(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'PATHEXT']);
const POSIX_ENVIRONMENT = Object.freeze(['TMPDIR', 'LANG', 'LANGUAGE', 'SHELL', 'USER', 'LOGNAME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']);
function childEnvironmentNames(platform = process.platform) {
  return platform === 'win32' ? [...WINDOWS_ENVIRONMENT] : [...WINDOWS_ENVIRONMENT, ...POSIX_ENVIRONMENT];
}
function childEnvironment(source, {platform = process.platform} = {}) {
  const env = {};
  if (!source || typeof source !== 'object') return env;
  for (const name of childEnvironmentNames(platform)) if (typeof source[name] === 'string') env[name] = source[name];
  // Locale categories (LC_ALL, LC_CTYPE, ...) decide how a POSIX child decodes text.
  if (platform !== 'win32') for (const name of Object.keys(source)) if (/^LC_[A-Z]{1,16}$/.test(name) && typeof source[name] === 'string') env[name] = source[name];
  return env;
}

const defaultIsFile = file => { try { return fs.statSync(file).isFile(); } catch { return false; } };
const defaultIsDirectory = file => { try { return fs.statSync(file).isDirectory(); } catch { return false; } };
const defaultList = directory => { try { return fs.readdirSync(directory); } catch { return []; } };
const usable = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\0\r\n]/.test(value);
function homeDirectory({platform = process.platform, env = process.env, home} = {}) {
  if (usable(home)) return home;
  const value = platform === 'win32' ? env?.USERPROFILE : env?.HOME;
  if (usable(value) && pathFor(platform).isAbsolute(value)) return value;
  // Only fall back to the operating system's answer for the real host.
  if (env === process.env && platform === process.platform) { try { return os.homedir(); } catch { return ''; } }
  return '';
}
const version = name => { const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name); return match ? match.slice(1).map(Number) : null; };
const newerFirst = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] - a[i]; return 0; };
// Places a command-line tool is commonly installed outside the short PATH that
// macOS gives an application started from Finder or the Dock (launchd does not
// read the login shell's profile). Windows keeps relying on its own PATH.
function commonDirectories({platform = process.platform, env = process.env, home, list = defaultList} = {}) {
  if (platform === 'win32') return [];
  const paths = pathFor(platform), user = homeDirectory({platform, env, home}), result = [];
  if (user) {
    result.push(paths.join(user, '.local', 'bin'), paths.join(user, '.claude', 'local'), paths.join(user, 'bin'),
      paths.join(user, '.npm-global', 'bin'), paths.join(user, '.volta', 'bin'), paths.join(user, '.bun', 'bin'),
      paths.join(user, '.asdf', 'shims'), paths.join(user, '.local', 'share', 'mise', 'shims'), paths.join(user, '.nodenv', 'shims'),
      paths.join(user, platform === 'darwin' ? paths.join('Library', 'Application Support', 'fnm') : paths.join('.local', 'share', 'fnm'), 'aliases', 'default', 'bin'));
    // nvm keeps one directory per version and adds it to PATH only in a shell.
    const nvm = paths.join(user, '.nvm', 'versions', 'node');
    const installed = list(nvm).slice(0, 200).map(name => ({name, parts: version(name)})).filter(item => item.parts).sort((a, b) => newerFirst(a.parts, b.parts));
    for (const item of installed.slice(0, 3)) result.push(paths.join(nvm, item.name, 'bin'));
  }
  if (platform === 'darwin') result.push('/opt/homebrew/bin', '/opt/homebrew/sbin');
  result.push('/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
  if (platform === 'linux') result.push('/snap/bin', '/home/linuxbrew/.linuxbrew/bin');
  return result;
}
function pathDirectories({platform = process.platform, env = process.env} = {}) {
  const paths = pathFor(platform);
  return String(env?.PATH || env?.Path || '').split(paths.delimiter).filter(folder => usable(folder) && paths.isAbsolute(folder));
}
// PATH first, then the common locations; duplicates removed, order preserved.
function searchDirectories({platform = process.platform, env = process.env, home, list = defaultList, directories} = {}) {
  const seen = new Set(), result = [];
  for (const folder of [...pathDirectories({platform, env}), ...(directories || commonDirectories({platform, env, home, list}))]) {
    if (!usable(folder) || seen.has(folder)) continue;
    seen.add(folder); result.push(folder);
  }
  return result;
}
// Returns an absolute path or null. The name is a fixed program name chosen by
// the caller, never text from a message or a file.
function findExecutable(name, {platform = process.platform, env = process.env, home, isFile = defaultIsFile, list = defaultList, directories} = {}) {
  if (typeof name !== 'string' || !/^[a-z][a-z0-9._-]{0,40}$/i.test(name)) throw Error('Invalid program name.');
  const paths = pathFor(platform), file = platform === 'win32' && !/\.exe$/i.test(name) ? `${name}.exe` : name;
  for (const folder of searchDirectories({platform, env, home, list, directories})) {
    const candidate = paths.join(folder, file);
    if (isFile(candidate)) return candidate;
  }
  return null;
}
// The PATH a child should see: the inherited one followed by the common
// locations that exist. On Windows this is the inherited value unchanged.
function augmentedPath({platform = process.platform, env = process.env, home, list = defaultList, isDirectory = defaultIsDirectory, directories} = {}) {
  const inherited = String(env?.PATH || env?.Path || '');
  if (platform === 'win32') return inherited;
  const paths = pathFor(platform), current = pathDirectories({platform, env}), seen = new Set(current), extra = [];
  for (const folder of directories || commonDirectories({platform, env, home, list})) {
    if (!usable(folder) || seen.has(folder) || !isDirectory(folder)) continue;
    seen.add(folder); extra.push(folder);
  }
  return [...current, ...extra].join(paths.delimiter);
}
// Called once at startup. A macOS or Linux desktop session may start the app
// with a PATH that lacks the user's tools; children (node, claude, git, codex)
// inherit this corrected value. No shell is started to read a profile.
function applyHostPath({platform = process.platform, env = process.env, home, list, isDirectory, directories} = {}) {
  if (platform === 'win32') return false;
  const next = augmentedPath({platform, env, home, list, isDirectory, directories});
  if (!next || next === env.PATH) return false;
  env.PATH = next; return true;
}

module.exports = {PLATFORMS, pathFor, isWindows, isMac, isLinux, modifierLabel, modifierKeyName, capabilities, windowsOnlyChannel, unsupportedResult,
  lifecycle, childEnvironmentNames, childEnvironment, homeDirectory, commonDirectories, pathDirectories, searchDirectories, findExecutable, augmentedPath, applyHostPath, WINDOWS_ONLY};
