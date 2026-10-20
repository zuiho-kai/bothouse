import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard } from './output.mjs';

export const name = 'conest-public-output';
export const inject = ['llm'];

export async function apply(ctx, config) {
  if (!Array.isArray(config?.providers) || !config.providers.length || config.providers.some(p=>typeof p!=='string'||!p)) throw Error('conest-public-output: providers must be explicit');
  // Resolve against the running DSH installation, not a second bundled copy:
  // the loop marker is a WeakSet owned by that exact runtime module instance.
  const require = createRequire(realpathSync(process.argv[1]));
  const { isAgentLoopRequest } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  if (typeof isAgentLoopRequest !== 'function') throw Error('conest-public-output: unsupported DSH runtime');
  ctx.logger.info('conest-public-output: structured public replies enabled (v3, provider recovery)');
  ctx.on('llm/stream', (options,next) => {
    if (!config.providers.includes(options.provider) || !isAgentLoopRequest(options)) return next();
    return guard(options,next,request=>ctx.llm.stream(request),diagnostic=>{
      // ACP owns stdout and does not install a durable Cordis log exporter.
      // guard supplies only module-owned enums/counters, never provider text.
      process.stderr.write(`[conest-public-output] ${JSON.stringify(diagnostic)}\n`);
      ctx.logger.warn('conest-public-output: %s',JSON.stringify(diagnostic));
    });
  });
}
