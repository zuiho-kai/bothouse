/**
 * 斜杠命令 /balance：刷新余额并把结果回给命令面板。
 * @module dsh-pet/src/host/plugin/command-balance
 */
import type { BalancePoll } from './balance-poll.ts';
import type { PetLookup } from './pet-lookup.ts';
import type { HostContext } from './context.ts';

/** 余额命令的输入。 */
export type CommandBalanceInput = {
  /** 宿主上下文（apply 收到的那一个）。 */
  ctx: HostContext;
} & Pick<BalancePoll, 'refreshBalance'> &
  Pick<BalancePoll, 'effectivePetList'> &
  Pick<PetLookup, 'sleep'> &
  Pick<PetLookup, 'sleepRefusalText'>;

/** 注册余额命令；返回的清理函数由 ctx.effect 收集。 */
export function registerBalanceCommand(deps: CommandBalanceInput): void {
  const { ctx, effectivePetList, refreshBalance, sleep, sleepRefusalText } = deps;
  // /balance 斜杠命令：触发一次余额刷新（写 S → 前端 1s 轮询看到后弹气泡）。
  // fire-and-forget：回执不等外部 API（查询可能要几秒），立刻回；结果一律从 S 看
  // （成功播档位动画 + 余额气泡；服务商不支持 / 缺凭证 / 抓取失败则弹文字说明气泡，绝不静默）。
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'balance',
        description: '手动触发桌宠余额显示（立即弹出余额气泡）',
        handler: () => {
          // 余额是全局一份数据，但「给谁看」要按宠物算：全都睡着就没人看，拒绝并回一句台词。
          const visible = effectivePetList().filter((pet) => String(pet.display ?? '') !== 'none');
          if (visible.length > 0 && visible.every((pet) => sleep.sleeping(String(pet.id ?? '')))) {
            return { kind: 'error', text: sleepRefusalText(String(visible[0].id ?? '')) };
          }
          void refreshBalance(true); // manual：命令是用户主动敲的
          return { kind: 'success', text: '已触发桌宠余额显示' };
        },
      }),
    'dsh-pet: /balance command',
  );
}
