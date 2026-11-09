// Installed DSH fs provider seam; arbitrary execution remains OS-confined.
import { registerHooks } from 'node:module';
const client = new URL('./client.mjs', import.meta.url).href;
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith('/@deepseek-ai/dsh-fs-local/lib/index.js')) return loaded;
    const source = Buffer.from(loaded.source).toString();
    for (const signature of ['async writeText(target, content, expected, signal)', 'async editText(target, edit, expected, signal)']) {
      if (!source.includes(signature)) throw new Error('QQ memory: DSH fs provider changed; revalidate before use');
    }
    return { ...loaded, source: source + `
import { isMemoryPath as qqMemoryPath, memoryRequest as qqMemoryRequest } from ${JSON.stringify(client)};
const qqWrite = LocalFileSystem.prototype.writeText;
const qqEdit = LocalFileSystem.prototype.editText;
LocalFileSystem.prototype.writeText = function(target, content, expected, signal) {
  return qqMemoryPath(target.targetKey)
    ? qqMemoryRequest({op: 'write', path: String(target.targetKey), content, expected})
    : qqWrite.call(this, target, content, expected, signal);
};
LocalFileSystem.prototype.editText = function(target, edit, expected, signal) {
  return qqMemoryPath(target.targetKey)
    ? qqMemoryRequest({op: 'edit', path: String(target.targetKey), edit, expected})
    : qqEdit.call(this, target, edit, expected, signal);
};
` };
  },
});
