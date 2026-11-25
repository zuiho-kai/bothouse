'use strict';

const assert = require('node:assert/strict');
const {execFileSync, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');

test('pinned import is byte-for-byte, idempotent and rejects unreviewed paths', () => {
  const temp = fs.realpathSync(os.tmpdir());
  const sandbox = fs.mkdtempSync(path.join(temp, 'bothouse-import-test-'));
  const source = path.join(sandbox, 'source');
  const destination = path.join(sandbox, 'destination');
  const script = path.join(destination, 'import.cjs');
  const manifestPath = path.join(destination, 'manifest.json');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], {windowsHide:true}).toString().trim();
  function run(...args) {
    const result = spawnSync(process.execPath, [script, ...args], {encoding:'utf8', windowsHide:true, timeout:10000});
    assert.ifError(result.error);
    return result;
  }
  const writeManifest = manifest => fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  try {
    fs.mkdirSync(source);
    fs.mkdirSync(destination);
    fs.copyFileSync(path.join(__dirname,'import.cjs'), script);
    git('init', '-q');
    fs.writeFileSync(path.join(source,'.gitattributes'), '* -text\n');
    fs.writeFileSync(path.join(source,'fixture.mjs'),'export const topic = "fixture";\r\n');
    fs.writeFileSync(path.join(source,'_development.mjs'),'export const development = true;\n');
    fs.mkdirSync(path.join(source,'.local'));
    fs.writeFileSync(path.join(source,'.local','not-for-import.txt'),'test-only marker');
    git('add','-f','--','.gitattributes','fixture.mjs','_development.mjs','.local/not-for-import.txt');
    git('-c','user.name=Importer Test','-c','user.email=importer@example.test','commit','-qm','Synthetic source');
    const commit = git('rev-parse','HEAD');
    const file = {path:'fixture.mjs',mode:'100644',blob:git('rev-parse',commit+':fixture.mjs')};
    const manifest = {schemaVersion:1,upstream:'https://github.com/zuiho-kai/bothouse',commit,
      groups:[{name:'fixture',files:[file]}, {name:'development',delivery:'development',files:[{
        path:'_development.mjs',mode:'100644',blob:git('rev-parse',commit+':_development.mjs'),
      }]}]};
    writeManifest(manifest);
    fs.writeFileSync(path.join(source,'fixture.mjs'),'Uncommitted source override\n');
    const first = run('--import',source);
    assert.equal(first.status,0,first.stderr);
    assert.equal(JSON.parse(first.stdout).written,1);
    assert.equal(fs.readFileSync(path.join(destination,'upstream','fixture.mjs'),'utf8'),
      'export const topic = "fixture";\r\n');
    const repeat = run('--import',source);
    assert.equal(repeat.status,0,repeat.stderr);
    assert.equal(JSON.parse(repeat.stdout).written,0);
    assert.equal(run('--check').status,0);
    assert.equal(run('--check',source).status,0);
    assert(!fs.existsSync(path.join(destination,'upstream','_development.mjs')));

    const development = run('--materialize',source);
    assert.equal(development.status,0,development.stderr);
    assert.equal(JSON.parse(development.stdout).written,2);
    assert.equal(run('--check-materialized',source).status,0);
    assert.equal(JSON.parse(run('--materialize',source).stdout).written,0);

    writeManifest({...manifest,groups:[{name:'fixture',files:[file,{
      path:'.local/not-for-import.txt',mode:'100644',blob:git('rev-parse',commit+':.local/not-for-import.txt'),
    }]}]});
    const privatePath = run('--import',source);
    assert.equal(privatePath.status,1);
    assert.match(privatePath.stderr,/private source path/u);
    for (const entry of ['plugins/desktop-pet/.env', 'plugins/desktop-pet/../.gitignore', '.hidden/test.mjs']) {
      writeManifest({...manifest,groups:[{name:'fixture',files:[{...file,path:entry}]}]});
      const rejected = run('--import',source);
      assert.equal(rejected.status,1);
      assert.match(rejected.stderr,/private source path/u);
    }
    writeManifest(manifest);
    fs.writeFileSync(path.join(destination,'upstream','fixture.mjs'),'Local modification\n');
    const drift = run('--import',source);
    assert.equal(drift.status,1);
    assert.match(drift.stderr,/Blob mismatch/u);
    assert.equal(fs.readFileSync(path.join(destination,'upstream','fixture.mjs'),'utf8'),'Local modification\n');
  } finally {
    const exact = fs.realpathSync(sandbox);
    assert.equal(path.dirname(exact),temp);
    assert(path.basename(exact).startsWith('bothouse-import-test-'));
    fs.rmSync(exact,{recursive:true,force:true});
  }
});
