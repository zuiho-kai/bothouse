// One-click judge model preset: the Qwen3.5-4B that bothouse itself runs (mlx-lm on Apple silicon).
// Same URL / model as JevPresetURL / JevPresetModel in core/setup_wizard.go.
import { Button } from '@/components/ui';

export const JEV_PRESET = { base_url: 'http://127.0.0.1:9941/v1', model: 'mlx-community/Qwen3.5-4B-MLX-4bit' };
const START = `mlx_lm.server --model ${JEV_PRESET.model} --host 127.0.0.1 --port 9941`;

// Numbers: download size from the Hugging Face model page (3.06 GB); memory measured on the
// author's Mac with `footprint` on the running mlx_lm.server (2026-11-07: 3.2 GB, peak 7.3 GB).
const TEXTS = {
  zh: {
    title: '推荐：Qwen3.5-4B（4bit，本机运行，免费、不要 Key）',
    what: '我们自己线上用的就是这个。下载约 3 GB；运行时常驻约 3.2 GB 内存，判断长消息时峰值约 7 GB。Apple 芯片的 Mac 内存和显存是同一块，不另占显存。',
    steps: '先在终端装、再起它（开着这个终端窗口）：',
    notMac: '这套只在 Apple 芯片的 Mac 上实测过；Windows、Linux 没有 mlx，暂时没有确定能用的一键预设。',
    uv: '# 没有 uv 先装：curl -LsSf https://astral.sh/uv/install.sh | sh',
    fill: '一键填', filled: '已填好，下面会自动测试。',
  },
  en: {
    title: 'Recommended: Qwen3.5-4B (4-bit, runs locally, free, no key)',
    what: 'This is what we run ourselves. About 3 GB to download; about 3.2 GB of memory while running, peaking near 7 GB on long messages. On Apple silicon memory and VRAM are the same pool.',
    steps: 'Install it, then start it in a terminal (keep that window open):',
    notMac: 'Only tested on Apple silicon Macs. Windows and Linux have no mlx, so there is no tested one-click preset there yet.',
    uv: '# No uv yet? curl -LsSf https://astral.sh/uv/install.sh | sh',
    fill: 'Fill in', filled: 'Filled in; it is tested automatically below.',
  },
  ja: {
    title: 'おすすめ：Qwen3.5-4B（4bit、ローカル実行、無料、Key 不要）',
    what: '私たちが実際に使っているモデルです。ダウンロード約 3 GB、実行中のメモリ約 3.2 GB（長いメッセージでピーク約 7 GB）。Apple シリコンの Mac はメモリと VRAM が共通です。',
    steps: 'ターミナルでインストールして起動します（そのウィンドウは開いたまま）：',
    notMac: 'Apple シリコンの Mac でのみ確認済みです。Windows / Linux には mlx がないため、確認済みのワンクリック設定はまだありません。',
    uv: '# uv がなければ：curl -LsSf https://astral.sh/uv/install.sh | sh',
    fill: 'ワンクリック入力', filled: '入力しました。下で自動テストします。',
  },
};

export const isMacBrowser = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '');

export function JevPreset({ lang, active, onFill }: { lang: string; active: boolean; onFill: () => void }) {
  const t = TEXTS[(lang || '').toLowerCase().split('-')[0] as keyof typeof TEXTS] ?? TEXTS.en;
  const mac = isMacBrowser();
  return (
    <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 dark:bg-emerald-900/10 p-3 space-y-1.5 text-xs" data-testid="jev-preset">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 dark:text-white">{t.title}</p>
        <Button size="sm" variant="secondary" data-testid="jev-preset-fill" onClick={onFill}>{t.fill}</Button>
      </div>
      <p className="text-gray-600 dark:text-gray-400">{t.what}</p>
      {mac ? (
        <>
          <p className="text-gray-600 dark:text-gray-400">{t.steps}</p>
          <pre className="whitespace-pre-wrap break-all rounded bg-white/70 dark:bg-black/30 p-2 font-mono text-[11px]">{`${t.uv}\nuv tool install mlx-lm\n${START}`}</pre>
        </>
      ) : <p className="text-amber-700 dark:text-amber-400">{t.notMac}</p>}
      {active && <p className="text-emerald-700 dark:text-emerald-400">{t.filled}</p>}
    </div>
  );
}
