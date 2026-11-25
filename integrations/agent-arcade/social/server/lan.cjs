'use strict';
// Disposable, opt-in LAN instance for two independent synthetic accounts.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'arcade-social-lan-'));
process.env.SOCIAL_HOST = '0.0.0.0';
process.env.SOCIAL_DB = path.join(dir,'synthetic.sqlite');
delete process.env.SOCIAL_PUBLIC_ORIGIN;
console.log('Synthetic test database (retain for restart):',process.env.SOCIAL_DB);
require('./main.cjs');
