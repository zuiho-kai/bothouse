/**
 * 桌面 Helper 三个子模块共用的输入类型，避免相互 import 形成环。
 *
 * 只声明依赖形状，不含实现；字段语义见各使用处。
 * @module dsh-pet/src/host/plugin/desktop/types
 */
import type { BalancePoll } from '../balance-poll.ts';
import type { DownloadReport } from '../download-report.ts';
import type { HostSetup } from '../setup.ts';
import type { HostContext } from '../context.ts';
import type { RouteResult } from '../../http.ts';

/** 桌面 Helper 生命周期的输入。 */
export type DesktopHelperDeps = Pick<HostSetup, 'configPaths' | 'log' | 'thumbUserRoot'> &
  Pick<BalancePoll, 'effectivePetList'> &
  Pick<DownloadReport, 'reportDownload'> & {
    /** 宿主上下文（apply 收到的那一个）。 */
    ctx: HostContext;
    /**
     * 路由处理器（惰性取用）：Helper 启动时才需要转发请求，因此这里拿的是"以后能取到处理器"的承诺，
     * 而不是处理器本身——否则它与路由装配会构成构造期循环。
     */
    getHandlePetRoute: () => (url: string, method: string, body?: string, signal?: AbortSignal) => Promise<RouteResult>;
  };
