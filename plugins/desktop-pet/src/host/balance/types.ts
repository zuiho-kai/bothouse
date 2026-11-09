/**
 * 余额查询的契约层（host 半侧）：服务商定义、取数上下文、路由结果与展示形态。
 *
 * 只有形状，不含具体服务商知识：接口地址、额度与解析各在 ./providers/<名>.ts。
 * 不 import 展示层（DSH 单文件加载约束），因此与 src/shared 各声明一份同构类型。
 * 始终成立：失败必须显式，0 余额只能来自接口。契约见 openapi.yaml。
 *
 * @module dsh-pet/src/host/balance/types
 */

/**
 * 凭证来源：ref 是 DSH credentialRef 名，由调用方解析后注入；none 表示该路由没有 API Key，
 * 凭证是 DSH 账号服务持有的授权记录，只能经服务查询。
 */
export type CredentialSpec = { mode: 'ref'; ref: string } | { mode: 'none' };

/** 内置服务商取数时收到的上下文。 */
export interface BalanceFetchContext {
  /** 命中的 provider id，原样回填进结果。 */
  provider: string;
  /** 已解析的 API Key；none 路由为空串。 */
  key: string;
  /** 账号余额查询；仅 none 路由使用。 */
  resolveAccount?: () => Promise<AccountBalanceSnapshot | null | undefined>;
}

/**
 * 第三方注册的 provider：只有 id 与取数。
 * 拿不到宿主解析的 key，也拿不到 resolveAccount；凭证由注册方自行解决。
 */
export interface PluginProvider {
  /** 命中的 provider id（必须与 agentDefaultModel 报告的 id 完全一致）。 */
  id: string;
  /** 取数并解析；只走成功路径，失败抛错，由 queryBalance 统一落成 fetch-error。 */
  fetch(ctx: PluginFetchContext): Promise<BalanceSuccess>;
}

/** 第三方取数上下文：只有 provider。 */
export interface PluginFetchContext {
  /** 命中的 provider id，原样回填进结果。 */
  provider: string;
}

/**
 * 一个内置服务商的余额查询定义：一个文件即一个自包含服务商。
 * 接口地址、业务常量与响应解析都在 ./providers/ 下它自己的文件里。
 */
export interface BalanceProvider {
  /** 可命中的 provider id（agentDefaultModel 报告的 id）。 */
  id: string;
  /** 凭证来源，决定 queryBalance 是解析凭证还是调服务。 */
  credential: CredentialSpec;
  /** 取数并解析；只走成功路径，失败抛错，由 queryBalance 统一落成 fetch-error。 */
  fetch(ctx: BalanceFetchContext): Promise<BalanceSuccess>;
}

/**
 * 展示形态：windows 为三窗口用量，money 为账户金额，points 为积分，custom 为第三方声明式布局。
 * 积分单列是因为 granted/toppedUp 在积分里没有意义；custom 则把布局也交给服务商。
 * 形态本身不含任何服务商信息。
 */
export type BalanceShape = 'windows' | 'money' | 'points' | 'custom';

/** 自定义气泡节点可用的标签。 */
export type CustomTag = 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';

/**
 * 自定义气泡节点（shape 为 custom 时的声明式布局树）。
 * 与 src/shared/balance/types.ts 的 CustomNode 同构；合法 tag、样式白名单与容量上限
 * 由客户端解析层强制，宿主半侧只负责把结构原样写进叶子。
 */
export interface CustomNode {
  tag: CustomTag;
  text?: string;
  /** 仅 img：http/https 地址。 */
  src?: string;
  /** camelCase 内联样式。 */
  style?: Record<string, string>;
  children?: CustomNode[];
}

/** shape 为 custom 的载荷：多页视图（或单页/两页写法）与可选档位百分比。 */
export interface CustomBalance {
  /** 多页视图（1~4 项，首项为初始页）；点击气泡循环切页，只有 1 页时不可点。 */
  views?: CustomNode[];
  /** 单页或两页写法：收起态树；给了 detailRows 等价于 views: [rows, detailRows]。 */
  rows?: CustomNode;
  /** 展开态树：仅两页写法使用。 */
  detailRows?: CustomNode;
  /** 已用百分比（0-100），驱动档位动画；缺省不播。 */
  percent?: number;
}

/** 计价档位装饰（气泡上的「峰/谷」），由服务商按自身计价规则算好后随数据带出。 */
export type PricingTier = 'peak' | 'idle';

/**
 * 区间累计用量（本期）：目前只有 commandcode 回传，给不出时整个字段缺省，气泡也就没有这一页。
 *
 * tokens 是毛值——接口不提供缓存命中拆分；requests 与 tokens 来自批量聚合，可能比窗口百分比滞后数分钟。
 */
export interface BalanceUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  spentUsd: number;
}

/**
 * 三窗口用量（windows 形态）：opencode 与 commandcode 共用，展示层因此共用「取最紧迫窗口」逻辑。
 * monthly 必有；rolling 与 weekly 缺省表示服务商没有该窗口，而非 0。三个满额度齐全时按剩余额度
 * 比较，否则退化为已用百分比；rollingLabel 是服务商业务事实，重置时间缺省按「已重置」处理。
 */
export interface WindowsUsage {
  monthly: number;
  rolling?: number;
  weekly?: number;
  rollingCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  rollingLabel?: string;
  rollingResetsAt?: string;
  weeklyResetsAt?: string;
  monthlyResetsAt?: string;
  /** 区间累计用量（可选页）；缺省表示该服务商没有这项数据 */
  usage?: BalanceUsage;
}

/**
 * 一个币种的余额（money 形态）：DeepSeek 官方路由与 DSH 账号路由同构。
 * 金额串与接口一致，不做换算、不重算；fullBalance 是该币种的档位基准，缺省表示无基准、不参与折算。
 * 账户可同时持有多个币种，故为数组；不同币种的基准不能互换。
 */
export interface MoneyWallet {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
  fullBalance?: string;
}

/** 账户金额（money 形态）；tier 为可选峰谷装饰，只有提供该规则的服务商才带。 */
export interface MoneyBalance {
  wallets: MoneyWallet[];
  tier?: PricingTier;
}

/**
 * 积分/点数余额（points 形态）：total 与接口一致，不做换算、不重算。
 * unit 只是数字后缀，不参与计算；full 是档位基准，缺省不折算、不播档位动画。
 */
export interface PointsBalance {
  unit: string;
  total: string;
  full?: string;
}

/**
 * DSH 账号服务的余额快照（ctx.deepseekAccount.getBalance 的返回，只取用到的字段）。
 * 与 dsh-deepseek-account 的 AccountDetails['balance'] 同构；金额是保留服务端精度的十进制字符串。
 * failed 表示查过但失败，与未登录的 null 不同。
 */
export interface AccountBalanceSnapshot {
  status: 'ready' | 'failed';
  /** 充值钱包（normal_wallets）。 */
  value?: readonly { currency?: unknown; balance?: unknown }[];
  /** 赠送钱包（bonus_wallets）。 */
  bonusWallets?: readonly { currency?: unknown; balance?: unknown }[];
}

/** 成功结果：shape 是展示形态，provider 是实际取数的服务商；client 与 host 同构使用。 */
export type BalanceSuccess =
  | { ok: true; provider: string; shape: 'windows'; data: WindowsUsage }
  | { ok: true; provider: string; shape: 'money'; data: MoneyBalance }
  | { ok: true; provider: string; shape: 'points'; data: PointsBalance }
  | { ok: true; provider: string; shape: 'custom'; data: CustomBalance };

/**
 * 查询结果：成功，或带 reason 的失败；失败绝不返回伪造数字。
 * reason 为 unsupported、credential-missing 或 fetch-error，message 可选。
 */
export type BalanceResult =
  | BalanceSuccess
  | { ok: false; provider: string; reason: 'unsupported' | 'credential-missing' | 'fetch-error'; message?: string };
