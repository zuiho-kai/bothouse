/**
 * 余额层的类型定义：wire 入参、已解析视图、气泡行数据与自定义节点树。
 *
 * 纯类型文件，唯一的导入是 `import type`，编译后消失，因此不依赖任何逻辑模块，也不会引入循环依赖。
 *
 * @module dsh-pet/src/shared/balance/types
 */

import type { QuotaTone } from './tone.ts';

/**
 * 展示形态：三种内置形态加一种完全自定义，不含任何服务商信息。
 *
 * - `windows`：三窗口用量，气泡报最紧迫窗口的已用百分比与重置倒计时。
 * - `money`：账户金额，气泡报余额与峰谷档位。
 * - `points`：非货币的积分或点数余额。
 * - `custom`：第三方交来的节点树，前三种表达不了的服务商（多模型分别余量、剩余次数、
 *   储值加赠送分栏…）走这条，插件不必逐个实现。
 *
 * 这里是 `Record<BalanceShape, ShapeHandler>` 的键类型，加形态时漏补 handler 会被编译拦住。
 */
export type BalanceShape = 'windows' | 'money' | 'points' | 'custom';

/**
 * 自定义气泡的 tag 白名单：只开放排版布局需要的几个。
 *
 * 用树而不是 HTML 字符串，两端渲染器才能共用一份白名单渲染器、不经 innerHTML，因而没有 XSS 面，
 * 也不必各写一套清洗器。越界内容在解析层就被丢掉（见 parse.ts），渲染器只负责画，不再做第二次校验。
 */
export type CustomTag = 'div' | 'span' | 'i' | 'b' | 'strong' | 'em' | 'img';

/** 自定义气泡的一个节点：标签、可选的文本或子节点，以及内联样式。 */
export interface CustomNode {
  tag: CustomTag;
  /** 文本片段，先于子节点渲染 */
  text?: string;
  /** 仅 `img` 有效，只接受 http 与 https */
  src?: string;
  /** 内联样式，键为 camelCase，解析层已按白名单过滤 */
  style?: Record<string, string>;
  children?: CustomNode[];
}

/**
 * custom 形态的载荷，解析层已把两种 wire 写法归一成 views。
 *
 * 页是点击循环切换的：第一项为初始页，点一下换下一页，末页回到第一页；只有一页时气泡不可点，
 * 页数上限见 CUSTOM_LIMITS.maxViews。
 */
export interface CustomBalance {
  views: CustomNode[];
  /** 已用百分比，驱动余额档位动画；缺省表示不播动画 */
  percent?: number;
}

/**
 * 余额叶子里的原始响应，与 host 侧 BalanceResult 手工保持同构。
 *
 * 两端各自声明结构而不是共用一个模块，是因为 host 侧受 DSH 单文件加载约束、不能 import 本目录。
 */
export interface RawBalanceResult {
  ok: boolean;
  provider?: string;
  /** 展示形态，由 host 写叶子时带上 */
  shape?: BalanceShape;
  reason?: string;
  message?: string;
  data?: {
    rolling?: unknown;
    weekly?: unknown;
    monthly?: unknown;
    rollingResetsAt?: unknown;
    weeklyResetsAt?: unknown;
    monthlyResetsAt?: unknown;
    rollingCapUsd?: unknown;
    weeklyCapUsd?: unknown;
    monthlyCapUsd?: unknown;
    rollingLabel?: unknown;
    /** windows：区间累计用量（可选页），给不全则整页不显示 */
    usage?: unknown;
    /** money：多币种钱包数组，每项一个币种 */
    wallets?: unknown;
    tier?: unknown;
    /** points：展示单位，只拼在数字后面，不参与计算 */
    unit?: unknown;
    /** points：当前余额，不做换算 */
    total?: unknown;
    /** points：档位基准，缺省则不参与百分比折算 */
    full?: unknown;
    /** custom：多页视图，第 1 项为初始页，优先于 rows */
    views?: unknown;
    /** custom：单页写法的节点树，与 views 二选一 */
    rows?: unknown;
    /** custom：老两页写法的第二页，与 rows 搭配 */
    detailRows?: unknown;
    /** custom：已用百分比，缺省则不播档位动画 */
    percent?: unknown;
  };
}

/** 计价档位装饰：由服务商算好后随数据带出，展示层原样渲染 */
export type PricingTier = 'peak' | 'idle';

/**
 * 区间累计用量（本期）：目前只有 commandcode 回传，是气泡的第三页。
 *
 * 与窗口百分比互不替代——那份是实时额度，这份是批量聚合的账目，可能滞后数分钟；tokens 是毛值。
 */
export interface BalanceUsage {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  spentUsd: number;
}

/** 已解析的余额视图，供展示与档位计算使用 */
export interface BalanceView {
  provider: string;
  shape: BalanceShape;
  ok: true;
  /**
   * 三窗口已用百分比（0-100）与各自的重置时间。`monthly` 必有（月度窗口是数据的底线）；
   * `rolling` 与 `weekly` 缺省表示该服务商没有这个窗口。
   */
  rolling?: number;
  weekly?: number;
  monthly?: number;
  rollingResetsAt?: string;
  weeklyResetsAt?: string;
  monthlyResetsAt?: string;
  /**
   * 各窗口满额度（USD），由服务商随数据带出，用于最紧迫窗口的绝对口径；缺省则退化为百分比口径。
   * 展示层不写死任何服务商的额度。
   */
  rollingCapUsd?: number;
  weeklyCapUsd?: number;
  monthlyCapUsd?: number;
  /** 滚动窗展示名，由服务商自报，缺省回落到 DEFAULT_ROLLING_LABEL */
  rollingLabel?: string;
  /** windows：区间累计用量；缺省表示该服务商没有这项数据，气泡只有两页 */
  usage?: BalanceUsage;
  /** money：多币种钱包，每项一个币种 */
  wallets?: MoneyWalletView[];
  /** money：计价档位装饰，缺省则渲染成不带峰谷的余额 */
  tier?: PricingTier;
  /** points：积分或点数余额，单位只用于展示 */
  points?: PointsView;
  /** custom：第三方自定义气泡，只有该形态带这份数据 */
  custom?: CustomBalance;
}

/** 积分或点数余额；`full` 缺省表示没有基准，不参与档位折算 */
export interface PointsView {
  unit: string;
  total: string;
  full?: string;
}

/** 一个币种的余额；`fullBalance` 缺省表示该币种没有基准，不参与档位折算 */
export interface MoneyWalletView {
  currency: string;
  total: string;
  granted: string;
  toppedUp: string;
  fullBalance?: string;
}

/** 余额不可用：不支持、缺凭证或抓取失败，显式标记而不静默 */
export interface BalanceUnavailable {
  provider: string;
  ok: false;
  reason: 'unsupported' | 'credential-missing' | 'fetch-error';
  message?: string;
}

/** 余额状态：可用视图或不可用标记 */
export type BalanceState = BalanceView | BalanceUnavailable;

/** 窗口类别，与服务商无关 */
export type WindowKey = 'rolling' | 'weekly' | 'monthly';

/** 一个窗口的额度概况，用于联想框的一句话判定 */
export interface WindowUsage {
  label: string;
  percent: number;
  /** 满额度（USD），算不出时缺省 */
  quotaUsd?: number;
  /** 剩余额度（USD），满额度未知时缺省 */
  remainingUsd?: number;
  resetsAt?: string;
}

/** 气泡行数据：role 决定两端的样式类，tier 用于峰谷着色 */
export type BalanceBubbleRow =
  | { role: 'label'; text: string }
  | { role: 'sub'; text: string }
  | { role: 'error'; text: string }
  | { role: 'tier'; tier: PricingTier; text: string }
  | {
      /** 展开态的一行，对应一个窗口 */
      role: 'quota';
      /** 纯文本兜底，不认识该 role 的消费方也能原样显示这一行 */
      text: string;
      label: string;
      /** 进度条长度，取值即已用百分比 */
      percent: number;
      tone: QuotaTone;
      usedText: string;
      resetText: string;
    }
  | {
      /** 用量页：三行两列的卡片，文本已由 shared 排好，渲染端只负责着色与对齐 */
      role: 'usage';
      /** 纯文本兜底，认不出该 role 的消费方也能把这块显示成一行 */
      text: string;
      /** 左上：固定标签 */
      title: string;
      /** 右上：区间总量（大字，整卡唯一的视觉焦点） */
      total: string;
      /** 第二行左：输入 */
      input: string;
      /** 第二行右：输出 */
      output: string;
      /** 第三行左：区间与请求数 */
      period: string;
      /** 第三行右：花费 */
      spend: string;
      /** 输入占比（0-100），驱动进出比例条；总量为 0 时缺省，此时不画条 */
      inputPercent?: number;
    };

/** 不可用状态是否弹文字说明的判定结果 */
export interface BalanceNoticeDecision {
  /** true 表示本次应弹气泡，false 表示同一原因已提示过且非显式请求 */
  show: boolean;
  /** 本次提示的原因标识，ok 状态为 null，调用方存下供下次比较 */
  key: string | null;
}
