'use strict';
// Builds the desktop pet models: node scripts/build-pets.cjs [--check]
// Each character script under scripts/pets/ is the editable source of its
// model; the output is src/pet/models/<id>.glb plus a small JSON with the
// numbers the face decal needs. --check rebuilds in memory and fails when the
// committed file differs, so the binary can always be traced to its source.
const fs = require('node:fs');
const path = require('node:path');

const out = path.resolve(__dirname, '..', 'src', 'pet', 'models');
const CHARACTERS = {ju: './pets/ju.cjs'};

function buildAll() {
  const results = [];
  for (const [id, file] of Object.entries(CHARACTERS)) {
    const source = require(file), model = source.build();
    results.push({id, glb: model.toGLB(), stats: model.stats(), meta: {id, face: source.FACE, head: source.HEAD, skin: source.COLORS.skin}});
  }
  return results;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let failed = false;
  for (const {id, glb, stats, meta} of buildAll()) {
    const file = path.join(out, `${id}.glb`), metaFile = path.join(out, `${id}.json`), metaText = JSON.stringify(meta, null, 2) + '\n';
    if (check) {
      const same = fs.existsSync(file) && fs.readFileSync(file).equals(glb) && fs.existsSync(metaFile) && fs.readFileSync(metaFile, 'utf8') === metaText;
      console.log(`${id}: ${same ? 'matches its source' : 'DIFFERS from scripts/pets/' + id + '.cjs; run node scripts/build-pets.cjs'}`);
      failed ||= !same;
    } else {
      fs.mkdirSync(out, {recursive: true});
      fs.writeFileSync(file, glb); fs.writeFileSync(metaFile, metaText);
      console.log(`${id}: ${glb.length} bytes, ${stats.bones} bones, body ${stats.parts.body.vertices} vertices / ${stats.parts.body.triangles} triangles, face ${stats.parts.face.vertices} vertices`);
    }
  }
  process.exit(failed ? 1 : 0);
}
module.exports = {buildAll, CHARACTERS};
