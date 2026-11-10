/**
 * 给第三方宿主命令的「/」菜单行补上标题与图标。
 * DSH 没有给命令配面孔的入口，只能包装 `commandUi.candidates`：它用闭包在运行时查实例方法，包一层即可。
 * 不负责命令的注册与执行，只改候选行；已带图标的行原样放行，将来官方支持后自动让位。
 * 降级原则：补丁异常只退回原始行，绝不弄坏「/」菜单；原方法自身的错误不吞。
 * @module dsh-pet/src/client/command-faces
 */
import type { ComponentType } from 'react';
import type { IconProps } from '@deepseek-ai/dsh-client-ui-primitives';

/** DSH `ctx.commandUi` 的最小形状，只声明面孔补丁用到的成员。 */
export interface CommandUiLike {
  /** 候选行方法；原型方法可被自有属性遮蔽。 */
  candidates?: (session: unknown, req: unknown) => Promise<unknown>;
}

/** 一个宿主命令在「/」菜单里的补充面孔。 */
export interface CommandFace {
  /** 行标题；每次候选轮询现取，语言切换在下一轮菜单打开时生效。 */
  label: () => string;
  /** 行图标；DSH 的图标格固定 14×14px，渲染时只传 `size`。 */
  icon: ComponentType<IconProps>;
}

/**
 * 给宿主命令的「/」菜单行补上标题与图标。
 * @param commandUi - commandUi 服务实例。
 * @param faces - 命令名（不带前导斜杠）到补充面孔的映射。
 * @returns 还原原方法的清理函数。
 */
export function installCommandFaces(commandUi: CommandUiLike, faces: ReadonlyMap<string, CommandFace>): () => void {
  const original = commandUi.candidates;
  if (typeof original !== 'function') {
    console.warn('[dsh-pet] 命令图标不可用：commandUi.candidates 缺失（命令本身仍可用，只是没有图标）');
    return () => {};
  }

  const patched = async (session: unknown, req: unknown): Promise<unknown> => {
    const rows: unknown = await original.call(commandUi, session, req);
    try {
      if (!Array.isArray(rows)) return rows;
      return rows.map((raw: unknown): unknown => {
        if (raw === null || typeof raw !== 'object') return raw;
        const row = raw as { name?: unknown; icon?: unknown };
        const face = faces.get(typeof row.name === 'string' ? row.name : '');
        // DSH 自己已经给了图标时原样放行，不覆盖。
        if (face === undefined || row.icon !== undefined) return row;
        return { ...row, label: face.label(), icon: face.icon };
      });
    } catch (error) {
      console.warn(
        '[dsh-pet] 命令图标补丁异常，本次退回原始菜单行：' + (error instanceof Error ? error.message : String(error)),
      );
      return rows;
    }
  };

  commandUi.candidates = patched;
  return () => {
    // 只还原自己装的那一份：后来者若又包了一层，别把它的包装抹掉。
    if (commandUi.candidates === patched) commandUi.candidates = original;
  };
}
