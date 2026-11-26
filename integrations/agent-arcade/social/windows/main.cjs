'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const configuration = require('./service.json');
const { serviceOrigin } = require('./endpoint.cjs');

serviceOrigin(configuration.origin, configuration.mode);
app.setName('Agent Arcade');
const testDirectory = process.argv.find(arg => arg.startsWith('--arcade-store-test-profile='))?.split('=').slice(1).join('=');
const hiddenTest = configuration.mode !== 'store' && path.isAbsolute(testDirectory || '');
const profile = hiddenTest ? testDirectory : path.join(app.getPath('appData'),
  configuration.mode === 'store' ? 'Agent Arcade Store' : 'Agent Arcade Store Packaging Test');
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.setPath('sessionData', profile);
process.env.AGENT_ARCADE_HOME = path.join(profile, 'library');
if (hiddenTest) process.env.AGENT_ARCADE_CLAUDE_SETTINGS = path.join(profile, 'synthetic-claude-settings.json');

module.exports = { hiddenTest };
require('./src/bootstrap.cjs');
