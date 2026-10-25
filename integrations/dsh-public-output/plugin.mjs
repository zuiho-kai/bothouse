import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { guard, publicReplyTool, publicReplyInstruction } from './output.mjs';

export const name = 'conest-public-output';
export const inject = ['llm'];

export async function apply(ctx, config) {
  if (!Array.isArray(config?.providers) || !config.providers.length || config.providers.some(p=>typeof p!=='string'||!p)) throw Error('conest-public-output: providers must be explicit');
  // Resolve against the running DSH installation, not a second bundled copy:
  // the loop marker is a WeakSet owned by that exact runtime module instance.
  const require = createRequire(realpathSync(process.argv[1]));
  const { isAgentLoopRequest } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  if (typeof isAgentLoopRequest !== 'function') throw Error('conest-public-output: unsupported DSH runtime');
  if (config.directReply === true) {
    if (!ctx.get('systemPrompt')) throw Error('conest-public-output: directReply requires systemPrompt');
    // Assemble before DSH logs/marks the request; do not rewrite a request
    // after logging or register this data-only schema with the tool executor.
    ctx.on('system-prompt/assemble',async (_assembly,_context,next)=>{
      const assembly = await next();
      if (!config.providers.includes(assembly.variables.provider)) return assembly;
      if (assembly.tools.some(tool=>tool.name === 'conest_public_reply')) throw Error('conest-public-output: duplicate public schema');
      return {...assembly,
        tools:[...assembly.tools,publicReplyTool()],
        sections:[...assembly.sections,{name:'conest:public-reply',text:publicReplyInstruction,interpolate:false}],
      };
    },{prepend:true});
  }
  ctx.logger.info('conest-public-output: structured public replies enabled (v5, directReply=%s)',config.directReply === true);
  ctx.on('llm/stream', (options,next) => {
    if (!config.providers.includes(options.provider) || !isAgentLoopRequest(options)) return next();
    return guard(options,next,request=>ctx.llm.stream(request),diagnostic=>{
      // ACP owns stdout and does not install a durable Cordis log exporter.
      // guard supplies only module-owned enums/counters, never provider text.
      process.stderr.write(`[conest-public-output] ${JSON.stringify(diagnostic)}\n`);
      ctx.logger.warn('conest-public-output: %s',JSON.stringify(diagnostic));
    },config.directReply === true);
  });
}
