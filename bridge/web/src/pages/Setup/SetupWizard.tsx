import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bot, Check, CheckCircle2, Copy, ExternalLink, Loader2, MessageSquare, Plus, RefreshCw, Smartphone, Trash2, XCircle } from 'lucide-react';
import { Badge, Button, Card, Input, Textarea } from '@/components/ui';
import PlatformSetupQR from '@/pages/Projects/PlatformSetupQR';
import { restartSystem } from '@/api/status';
import {
  applyWizard, checkDiscord, getSetupPersona, getCLIs, getExistingBots, getMatrix, getPersonas, getSetupState, listChannels, listFeishuChats, testJev, saveJev,
  type DiscordBotInfo, type DiscordChannel, type ExistingBot, type LocalCLI, type MatrixCell, type PersonaPreset,
  type SetupStateResp, type WizardRequest, type WizardResult, type WizardVendor,
} from '@/api/wizard';
import { isZhLang, langLabel, replyLangOptions, wizardTexts } from './texts';

interface RoleDraft {
  key: number;
  reuse_project?: string;
  token: string;
  info?: DiscordBotInfo;
  checking?: boolean;
  error?: string;
  agent_type: string;
  useProvider: boolean;
  provider: { vendor: string; base_url: string; api_key: string; model: string };
  persona: string;
  reply_language: string;
  replyTouched?: boolean; // picked by hand for this role: the language picker no longer changes it
  // existing bot (reuse_project): its persona file is only written when editPersona is ticked
  existingWorkDir?: string;
  existingPersona?: { path: string; exists: boolean; content: string };
  editPersona?: boolean;
}

// Same as core memoryFileOfAgent: the instruction file each CLI reads from its work_dir.
const MEMORY_FILE: Record<string, string> = {
  claudecode: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md', antigravity: 'GEMINI.md',
  opencode: 'OPENCODE.md', iflow: 'IFLOW.md', reasonix: 'REASONIX.md',
};
// Vendors without a default model need one typed in (core validateWizardProvider).


// Same rule as core/setup_wizard.go cleanProjectName.
const cleanName = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

const selectCls = 'w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-accent/50';

let keySeq = 1;

export default function SetupWizard() {
  const { i18n } = useTranslation();
  const lang = i18n.language || 'en';
  const zh = isZhLang(lang);
  const T = wizardTexts(lang);
  // default reply language = the UI language picked at the top right, as is (zh-TW, ko … too)
  const sysReply = lang;

  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<'discord' | 'feishu'>('discord');
  const [state, setState] = useState<SetupStateResp | null>(null);
  const [clis, setClis] = useState<LocalCLI[] | null>(null);
  const [vendors, setVendors] = useState<WizardVendor[]>([]);
  const [matrix, setMatrix] = useState<MatrixCell[]>([]);
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [existing, setExisting] = useState<ExistingBot[]>([]);
  const newRole = useCallback((): RoleDraft => ({
    key: keySeq++, token: '', agent_type: '', useProvider: false,
    provider: { vendor: 'deepseek', base_url: '', api_key: '', model: '' }, persona: '', reply_language: sysReply,
  }), [sysReply]);
  const [roles, setRoles] = useState<RoleDraft[]>(() => [newRole()]);
  // the language picker sets the reply language of every role not picked by hand
  useEffect(() => { setRoles((rs) => rs.map((r) => (r.replyTouched ? r : { ...r, reply_language: lang }))); }, [lang]);
  const [guildID, setGuildID] = useState('');
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [channelID, setChannelID] = useState('');
  const [feishu, setFeishu] = useState<{ app_id: string; app_secret: string; platform_type: string; owner_open_id?: string } | null>(null);
  const [chats, setChats] = useState<{ chat_id: string; name: string }[] | null>(null);
  const [chatID, setChatID] = useState('');
  const [fallback, setFallback] = useState('');
  const [jev, setJev] = useState({ base_url: '', api_key: '', model: '' });
  // jevTest: the gate-style test (nothing written); jevSave: what 下一步 / 跳过 did to jev.json
  const [jevTest, setJevTest] = useState<{ running: boolean; usable?: boolean; reason?: string; hint?: string }>({ running: false });
  const [jevSave, setJevSave] = useState<{ saving?: boolean; saved?: boolean; cleared?: boolean; inUse?: string; error?: string }>({});
  const jevPrefilled = useRef(false);
  const [result, setResult] = useState<WizardResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [restarted, setRestarted] = useState(false);
  const [copied, setCopied] = useState('');
  // allow_from: defaults to the bots' owners (from the token check) until the user edits it
  const [allowFrom, setAllowFrom] = useState<string | null>(null);

  useEffect(() => {
    getSetupState(lang).then(setState).catch(() => {});
    getCLIs().then((r) => setClis(r.clis)).catch(() => setClis([]));
    getMatrix().then((r) => { setVendors(r.vendors); setMatrix(r.matrix); }).catch(() => {});
    getExistingBots().then((r) => setExisting(r.bots)).catch(() => {});
  }, [lang]);
  // refresh the jev hint with the fallback bot's name when reaching the jev step
  useEffect(() => { if (step === 5) getSetupState(lang, fallbackName).then(setState).catch(() => {}); }, [step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { getPersonas(zh ? 'zh' : 'en').then((r) => setPresets(r.presets)).catch(() => {}); }, [zh]);

  // default CLI: first installed one that is logged in, else first supported
  const defaultAgent = useMemo(() => {
    const ok = (clis || []).filter((c) => c.supported);
    return (ok.find((c) => c.login === 'logged_in') || ok[0])?.agent_type || '';
  }, [clis]);
  useEffect(() => {
    if (defaultAgent) setRoles((rs) => rs.map((r) => (r.agent_type ? r : { ...r, agent_type: defaultAgent })));
  }, [defaultAgent]);

  const patchRole = (key: number, p: Partial<RoleDraft>) => setRoles((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  // Same rule as core ApplyWizard: an existing bot keeps its project name as is; a new bot's
  // name is cleaned, then falls back to role-N, then gets -N if taken.
  const projectNames = useMemo(() => {
    const taken = new Set<string>(state?.projects || []);
    const used = new Set<string>();
    return roles.map((r, i) => {
      if (r.reuse_project) { used.add(r.reuse_project); return r.reuse_project; }
      const same = existing.find((b) => b.bot_id && b.bot_id === r.info?.bot_id);
      if (same) { used.add(same.project); return same.project; } // the same bot is already configured
      const base = cleanName(r.info?.username || '') || `role-${i + 1}`;
      let n = base;
      for (let k = 2; taken.has(n) || used.has(n); k++) n = `${base}-${k}`;
      used.add(n);
      return n;
    });
  }, [roles, state?.projects, existing]);
  const projectOf = (r: RoleDraft) => projectNames[roles.indexOf(r)] ?? `role-${roles.indexOf(r) + 1}`;
  const nameOf = (r: RoleDraft) => r.info?.username || r.reuse_project || projectOf(r);

  // ── Discord ──
  const check = async (r: RoleDraft, body: { token?: string; reuse_project?: string }) => {
    patchRole(r.key, { checking: true, error: undefined });
    try {
      const info = await checkDiscord(body);
      // A pasted token of a bot that is already configured is that existing bot: switch to the
      // reuse view (its persona is shown read-only and only written when 改人设 is ticked).
      const reuse = body.reuse_project || existing.find((b) => b.bot_id && b.bot_id === info.bot_id)?.project;
      patchRole(r.key, { info, checking: false, ...(reuse ? { reuse_project: reuse, token: '' } : {}) });
      // an existing bot keeps its server: default to the guild already in its config (H3.3)
      const exGuild = reuse ? existing.find((b) => b.project === reuse)?.guild_id : undefined;
      if (!guildID) setGuildID(exGuild || info.guilds[0]?.id || '');
      if (reuse) {
        const ex = existing.find((b) => b.project === reuse);
        patchRole(r.key, { agent_type: ex?.agent_type || r.agent_type, existingWorkDir: ex?.work_dir, editPersona: false, persona: '' });
        if (ex?.work_dir) {
          getSetupPersona(ex.agent_type, ex.work_dir).then((p) => patchRole(r.key, { existingPersona: p })).catch(() => {});
        }
      }
    } catch (e: any) {
      patchRole(r.key, { checking: false, error: e?.message || String(e), info: undefined });
    }
  };
  const first = roles[0];
  useEffect(() => {
    if (!guildID || !first?.info) return;
    listChannels({ guild_id: guildID, ...(first.reuse_project ? { reuse_project: first.reuse_project } : { token: first.token }) })
      .then((r) => { setChannels(r.channels); setChannelID((c) => (r.channels.some((x) => x.id === c) ? c : r.channels[0]?.id || '')); })
      .catch(() => setChannels([]));
  }, [guildID, first?.info, first?.reuse_project, first?.token]);
  const guilds = first?.info?.guilds || [];

  // ── Feishu chats ──
  const loadChats = useCallback(async () => {
    if (!feishu) return;
    try {
      const r = await listFeishuChats(feishu);
      setChats(r.chats);
      if (r.chats[0]) setChatID((c) => c || r.chats[0].chat_id);
    } catch { setChats([]); }
  }, [feishu]);
  useEffect(() => { loadChats(); }, [loadChats]);

  // ── fallback default = first bot ──
  const projects = roles.map(projectOf);
  useEffect(() => {
    if (!projects.includes(fallback)) setFallback(projects[0] || '');
  }, [projects.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const fallbackName = nameOf(roles.find((r) => projectOf(r) === fallback) || roles[0]);

  // ── jev: prefill the one in use; test on change (nothing written); 下一步 saves, 跳过 removes ──
  const existingJev = state?.jev?.logprobs ? state.jev : undefined;
  useEffect(() => {
    if (existingJev && !jevPrefilled.current) {
      jevPrefilled.current = true;
      setJev({ base_url: existingJev.url, api_key: '', model: existingJev.model });
    }
  }, [existingJev?.url, existingJev?.model]); // eslint-disable-line react-hooks/exhaustive-deps
  const jevUnchanged = !!existingJev && jev.base_url === existingJev.url && jev.model === existingJev.model && !jev.api_key;
  const jevTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(jevTimer.current);
    setJevSave({});
    if (!jev.base_url || !jev.model || jevUnchanged) { setJevTest({ running: false }); return; }
    jevTimer.current = window.setTimeout(async () => {
      setJevTest({ running: true });
      try {
        const r = await testJev({ ...jev, lang, fallback_name: fallbackName });
        setJevTest({ running: false, usable: r.usable, reason: r.reason, hint: r.hint });
      } catch (e: any) {
        setJevTest({ running: false, usable: false, reason: e?.message || String(e) });
      }
    }, 800); // 来源：输入停顿后再测，免得每敲一个字发一次请求（无数据依据的交互延迟，可改）
    return () => window.clearTimeout(jevTimer.current);
  }, [jev.base_url, jev.api_key, jev.model, lang, fallbackName, jevUnchanged]);

  // 下一步 on the jev step: unchanged → keep; empty → remove; tested usable → save. 跳过 → remove.
  // 下一步 / 跳过 never remove a working jev: skipping (or leaving the boxes empty) keeps the one in
  // use. Only the explicit 不用 jev button removes jev.json. A tested, usable new jev is saved on 下一步.
  const keepExistingJev = () => setJev(existingJev ? { base_url: existingJev.url, api_key: '', model: existingJev.model } : { base_url: '', api_key: '', model: '' });
  const jevNext = async (mode: 'next' | 'skip' | 'remove' = 'next') => {
    if (mode === 'skip' || (mode === 'next' && (jevUnchanged || !jev.base_url))) { keepExistingJev(); go(1); return; }
    const body = mode === 'remove' ? { base_url: '', api_key: '', model: '', remove: true } : jev;
    setJevSave({ saving: true });
    try {
      const r = await saveJev({ ...body, lang, fallback_name: fallbackName });
      setJevSave({ saved: r.saved, cleared: r.cleared, inUse: r.in_use });
      if (r.saved || r.cleared) {
        if (r.cleared) { jevPrefilled.current = true; setJev({ base_url: '', api_key: '', model: '' }); setState((st) => (st ? { ...st, jev: undefined } : st)); }
        go(1);
      } else {
        setJevTest({ running: false, usable: false, reason: r.reason, hint: r.hint });
      }
    } catch (e: any) {
      setJevSave({ error: e?.message || String(e) });
    }
  };

  const ownerDefault = Array.from(new Set(roles.map((r) => r.info?.owner_id).filter(Boolean))).join(',');
  const allowFromValue = allowFrom ?? ownerDefault;

  // ── request ──
  const buildRequest = (maskSecrets = false): WizardRequest => {
    const mask = (s: string, ph: string) => (maskSecrets && s ? ph : s);
    const req: WizardRequest = {
      platform: platform === 'feishu' ? ((feishu?.platform_type as 'feishu' | 'lark') || 'feishu') : 'discord',
      language: lang,
      roles: roles.map((r, i) => ({
        ...(r.reuse_project ? { reuse_project: r.reuse_project } : platform === 'discord' ? { token: mask(r.token, `<BOT_TOKEN_${i + 1}>`) } : {}),
        ...(platform === 'feishu' ? { name: 'feishu-bot' } : {}),
        agent_type: r.agent_type,
        ...(!r.reuse_project ? { persona: r.persona || undefined, reply_language: r.reply_language }
          : r.editPersona ? { persona: r.persona || undefined, reply_language: r.reply_language, edit_persona: true } : {}),
        ...(r.useProvider ? { provider: { vendor: r.provider.vendor, base_url: r.provider.base_url || undefined,
          api_key: mask(r.provider.api_key, '<API_KEY>'), model: r.provider.model || undefined } } : {}),
      })),
      fallback_role: platform === 'discord' ? fallback : undefined,
      fallback_bot_id: platform === 'discord' ? roles.find((r) => projectOf(r) === fallback)?.info?.bot_id : undefined,
    };
    if (platform === 'discord') {
      req.discord = { guild_id: guildID, channel_id: channelID };
      if (allowFromValue.trim()) req.allow_from = allowFromValue.trim();
    }
    if (platform === 'feishu' && feishu) req.feishu = { ...feishu, app_secret: mask(feishu.app_secret, '<APP_SECRET>'), chat_id: chatID };
    if (maskSecrets && jev.base_url) req.jev = { base_url: jev.base_url, api_key: mask(jev.api_key, '<JEV_KEY>'), model: jev.model };
    return req;
  };

  const save = async () => {
    setSaving(true);
    try { setResult(await applyWizard(buildRequest())); } catch (e: any) {
      setResult({ ok: false, error: e?.message || String(e), steps: [], roles: [], jev_ok: false, jev_hint: '', hardware: false, restart_required: false, dry_run: false });
    }
    setSaving(false);
    setStep(6);
  };

  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: text stays visible */ }
    setCopied(id);
    window.setTimeout(() => setCopied(''), 1500); // 来源：“已复制”提示停留时间，纯界面
  };

  const cliPrompt = (r: RoleDraft) => {
    const body = JSON.stringify({ ...buildRequest(true), roles: [buildRequest(true).roles[roles.indexOf(r)]] }, null, 2);
    const vendor = vendors.find((v) => v.id === r.provider.vendor);
    return zh
      ? `请帮我把本机 cc-connect 的角色「${nameOf(r)}」配置成用第三方 API${vendor ? `（${vendor.label}）` : ''}，挂在 ${r.agent_type} 上。\n` +
        `做法：在 cc-connect 目录运行 \`cc-connect setup matrix\` 看这家挂到 ${r.agent_type} 是原生还是转换；` +
        `然后把下面的 JSON 存成文件，把占位符换成真实值，运行 \`cc-connect setup apply --json <文件>\`（或 POST 到 http://localhost:<管理端口>/api/v1/setup/apply）。\n` +
        `key 我会单独给你，不要打印或写进日志。做完把输出 JSON 里的 steps 告诉我。\n\n${body}`
      : `Please configure the cc-connect role "${nameOf(r)}" on this machine to use a third-party API${vendor ? ` (${vendor.label})` : ''} on ${r.agent_type}.\n` +
        `Run \`cc-connect setup matrix\` to see whether this provider is native or converted for ${r.agent_type}; then save the JSON below to a file, ` +
        `replace the placeholders, and run \`cc-connect setup apply --json <file>\` (or POST it to http://localhost:<management port>/api/v1/setup/apply).\n` +
        `I will give you the key separately; never print or log it. Tell me the "steps" from the output JSON.\n\n${body}`;
  };

  // ── step validity ──
  const stepOK = [
    true,
    platform === 'discord' ? roles.every((r) => r.info) && !!guildID : !!feishu,
    roles.every((r) => {
      if (!r.agent_type) return false;
      if (!r.useProvider) return true;
      const v = vendors.find((x) => x.id === r.provider.vendor);
      if (r.provider.vendor === 'custom' && !r.provider.base_url) return false; // custom: base_url required
      if (!v?.model && !r.provider.model) return false;                      // no default model: model required
      return true;
    }),
    true, !!fallback || platform === 'feishu',
    // jev: empty (= skip), the one already in use, or tested usable; a failing one is never written — try another or skip
    !jevTest.running && !jevSave.saving && (!jev.base_url ? true : !jev.model ? false : jevUnchanged || jevTest.usable === true), true,
  ];
  const visibleSteps = platform === 'feishu' ? [0, 1, 2, 3, 5, 6] : [0, 1, 2, 3, 4, 5, 6];
  const pos = visibleSteps.indexOf(step);
  const go = (d: number) => setStep(visibleSteps[Math.min(Math.max(pos + d, 0), visibleSteps.length - 1)]);

  const loginBadge = (c: LocalCLI) =>
    c.login === 'logged_in' ? <Badge variant="success">{T.loggedIn}</Badge>
      : c.login === 'not_logged_in' ? <Badge variant="warning">{T.notLoggedIn}</Badge> : <Badge>{T.unknownLogin}</Badge>;

  return (
    <div className="animate-fade-in space-y-4 max-w-3xl" data-testid="setup-wizard">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{T.title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{T.subtitle}</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 mt-1" data-testid="reply-lang-line">{T.replyLangLine}<b>{langLabel(lang)}</b><span className="text-xs text-gray-500">{T.replyLangHow}</span></p>
        </div>
        <Link to="/projects?manual=1" className="text-xs text-gray-400 hover:text-accent whitespace-nowrap">{T.manualOther}</Link>
      </div>

      {/* stepper */}
      <div className="flex flex-wrap gap-1.5">
        {visibleSteps.map((s, i) => (
          <span key={s} className={`px-2.5 py-1 rounded-full text-xs ${s === step ? 'bg-accent text-white dark:text-black' : i < pos ? 'bg-accent/15 text-accent' : 'bg-gray-100 dark:bg-white/[0.06] text-gray-500'}`}>
            {i + 1}. {T.steps[s]}
          </span>
        ))}
      </div>

      <Card className="space-y-4 text-gray-800 dark:text-gray-200">
        {/* 0 platform */}
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{T.platformQ}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([['discord', 'Discord', T.discordDesc, MessageSquare], ['feishu', zh ? '飞书 / Lark' : 'Feishu / Lark', T.feishuDesc, Smartphone]] as const).map(([k, label, desc, Icon]) => (
                <button key={k} data-testid={`platform-${k}`} onClick={() => { setPlatform(k); if (k === 'feishu') setRoles((rs) => rs.slice(0, 1)); }}
                  className={`text-left p-4 rounded-xl border transition-all ${platform === k ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 hover:border-accent/50'}`}>
                  <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white"><Icon size={16} />{label}{platform === k && <Check size={14} className="text-accent" />}</div>
                  <p className="text-xs text-gray-500 mt-1">{desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 1 bots (discord) */}
        {step === 1 && platform === 'discord' && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">{T.rolesNote}</p>
            {roles.map((r, idx) => (
              <div key={r.key} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3" data-testid={`role-${idx}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200"><Bot size={14} className="inline mr-1" />{T.roleLabel} {idx + 1}{r.info && ` · ${r.info.username}`}</span>
                  {roles.length > 1 && <Button size="sm" variant="ghost" onClick={() => setRoles((rs) => rs.filter((x) => x.key !== r.key))}><Trash2 size={12} />{T.remove}</Button>}
                </div>
                {existing.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-gray-500">{T.existingBots}</p>
                    <div className="flex flex-wrap gap-2">
                      {existing.map((b) => {
                        const taken = roles.some((o) => o.key !== r.key && o.reuse_project === b.project);
                        const sel = r.reuse_project === b.project;
                        return (
                          <Button key={b.project} size="sm" variant={sel ? 'primary' : 'secondary'} disabled={taken || !!b.error}
                            onClick={() => check(r, { reuse_project: b.project })}>
                            {sel ? <Check size={12} /> : null}{b.username || b.project}<span className="opacity-60">({b.project})</span>
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!r.reuse_project && (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">{T.noBotHelp} <a className="text-accent inline-flex items-center gap-0.5" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">{T.openPortal}<ExternalLink size={11} /></a></p>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1"><Input type="password" label={T.tokenLabel} value={r.token} data-testid={`token-${idx}`}
                        onChange={(e) => patchRole(r.key, { token: e.target.value.trim(), info: undefined })} /></div>
                      <Button disabled={!r.token || r.checking} onClick={() => check(r, { token: r.token })} data-testid={`check-${idx}`}>
                        {r.checking ? <Loader2 size={14} className="animate-spin" /> : null}{r.checking ? T.checking : T.check}
                      </Button>
                    </div>
                  </div>
                )}
                {r.error && <p className="text-xs text-red-500 flex items-center gap-1"><XCircle size={12} />{r.error}</p>}
                {r.info && (
                  <div className="text-xs space-y-1">
                    <p className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={12} />{r.info.username} ({r.info.bot_id})</p>
                    {r.info.intent_known === false
                      ? <p className="text-amber-600">{T.intentUnknown}</p>
                      : !r.info.message_content_intent && <p className="text-amber-600">{T.intentOff}</p>}
                    {guildID && !r.info.guilds.some((g) => g.id === guildID) && (
                      <p className="text-amber-600">{T.notInGuild} <a className="text-accent underline" target="_blank" rel="noreferrer"
                        href={`${r.info.invite_url}&guild_id=${guildID}`}>{T.invite}</a></p>
                    )}
                  </div>
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setRoles((rs) => [...rs, { ...newRole(), agent_type: defaultAgent }])}><Plus size={12} />{T.addRole}</Button>
            {first?.info && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{T.server}</label>
                  <select className={selectCls} value={guildID} onChange={(e) => setGuildID(e.target.value)} data-testid="guild">
                    {guilds.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                  {guilds.length === 0 && <p className="text-xs text-amber-600 mt-1">{T.notInGuild} <a className="text-accent underline" href={first.info.invite_url} target="_blank" rel="noreferrer">{T.invite}</a></p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{T.channel}</label>
                  <select className={selectCls} value={channelID} onChange={(e) => setChannelID(e.target.value)} data-testid="channel">
                    {channels.map((c) => <option key={c.id} value={c.id}>#{c.name}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 1 feishu */}
        {step === 1 && platform === 'feishu' && (
          !feishu ? (
            <PlatformSetupQR platformType="feishu" projectName="feishu-bot" onComplete={() => {}} onCancel={() => go(-1)}
              onCredentials={(c) => setFeishu(c)} />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14} />{T.feishuScanned}</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{T.chatQ}</label>
                {chats && chats.length > 0 ? (
                  <select className={selectCls} value={chatID} onChange={(e) => setChatID(e.target.value)}>
                    {chats.map((c) => <option key={c.chat_id} value={c.chat_id}>{c.name || c.chat_id}</option>)}
                  </select>
                ) : <p className="text-xs text-gray-500">{T.chatEmpty}</p>}
                <Button size="sm" variant="ghost" onClick={loadChats}><RefreshCw size={12} />{T.refresh}</Button>
              </div>
            </div>
          )
        )}

        {/* 2 CLI per role */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">{T.cliQ}</p>
            {clis && clis.filter((c) => c.supported).length === 0 && <p className="text-sm text-red-500">{T.noCLI}</p>}
            {roles.map((r, idx) => {
              const cell = matrix.find((m) => m.vendor === r.provider.vendor && m.agent_type === r.agent_type);
              const vendor = vendors.find((v) => v.id === r.provider.vendor);
              const attachable = ['claudecode', 'codex', 'gemini', 'opencode'].includes(r.agent_type);
              const via = r.provider.base_url && vendor && r.provider.base_url !== vendor.openai_base && r.agent_type !== 'opencode' ? 'convert' : cell?.mode;
              return (
                <div key={r.key} className="p-3 rounded-xl border border-gray-200 dark:border-gray-700 space-y-3" data-testid={`cli-role-${idx}`}>
                  {roles.length > 1 && <p className="text-sm font-medium">{nameOf(r)}</p>}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(clis || []).map((c) => (
                      <button key={c.label} disabled={!c.supported} onClick={() => patchRole(r.key, { agent_type: c.agent_type })}
                        data-testid={`cli-${idx}-${c.agent_type || c.label}`}
                        className={`text-left p-2.5 rounded-lg border text-sm text-gray-900 dark:text-gray-100 ${!c.supported ? 'opacity-50 cursor-not-allowed border-dashed border-gray-300' : r.agent_type === c.agent_type ? 'border-accent bg-accent/5' : 'border-gray-200 dark:border-gray-700 hover:border-accent/50'}`}>
                        <div className="flex items-center justify-between gap-2"><span className="font-medium">{c.label}</span>{c.supported ? loginBadge(c) : <Badge>{T.unsupported}</Badge>}</div>
                        <div className="text-[11px] text-gray-400 truncate">{c.version || c.path}</div>
                        {c.note && <div className="text-[11px] text-amber-600">{c.note}</div>}
                      </button>
                    ))}
                  </div>
                  {attachable && (
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.useProvider} data-testid={`use-provider-${idx}`}
                      onChange={(e) => patchRole(r.key, { useProvider: e.target.checked })} />{T.thirdParty}</label>
                  )}
                  {attachable && r.useProvider && (
                    <div className="space-y-2 pl-5">
                      <select className={selectCls} value={r.provider.vendor} data-testid={`vendor-${idx}`}
                        onChange={(e) => { const v = vendors.find((x) => x.id === e.target.value); patchRole(r.key, { provider: { ...r.provider, vendor: e.target.value, base_url: v?.id === 'custom' ? '' : v?.openai_base || '', model: v?.model || '' } }); }}>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </select>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Input placeholder={vendor?.openai_base || 'https://…/v1'} label={T.baseURL} value={r.provider.base_url}
                          onChange={(e) => patchRole(r.key, { provider: { ...r.provider, base_url: e.target.value.trim() } })} />
                        <Input type="password" label={T.apiKey} value={r.provider.api_key} data-testid={`provider-key-${idx}`}
                          onChange={(e) => patchRole(r.key, { provider: { ...r.provider, api_key: e.target.value.trim() } })} />
                        <Input label={T.model} placeholder={vendor?.model || ''} value={r.provider.model} data-testid={`provider-model-${idx}`}
                          onChange={(e) => patchRole(r.key, { provider: { ...r.provider, model: e.target.value.trim() } })} />
                      </div>
                      {via && <p className="text-xs text-gray-500"><Badge variant={via === 'native' ? 'success' : 'info'}>{via === 'native' ? T.native : T.convert}</Badge> {via === 'native' ? T.viaNative : T.viaConvert}</p>}
                      {vendor?.signup_url && <a className="text-xs text-accent inline-flex items-center gap-0.5" href={vendor.signup_url} target="_blank" rel="noreferrer">{vendor.signup_url}<ExternalLink size={10} /></a>}
                    </div>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => copy(`p${r.key}`, cliPrompt(r))} data-testid={`copy-prompt-${idx}`}>
                    <Copy size={12} />{copied === `p${r.key}` ? T.copied : T.copyPrompt}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* 3 persona */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">{T.personaQ}</p>
            <p className="text-xs text-gray-500" data-testid="persona-about">{T.personaAbout}</p>
            {roles.map((r, idx) => (
              <div key={r.key} className="space-y-2 p-3 rounded-xl border border-gray-200 dark:border-gray-700" data-testid={`persona-role-${idx}`}>
                {roles.length > 1 && <p className="text-sm font-medium">{nameOf(r)}</p>}
                {r.reuse_project && (
                  <label className="flex items-center gap-2 text-sm" data-testid={`edit-persona-${idx}`}>
                    <input type="checkbox" checked={!!r.editPersona} disabled={!r.existingWorkDir}
                      onChange={(e) => patchRole(r.key, { editPersona: e.target.checked, persona: e.target.checked ? (r.existingPersona?.content || '') : '' })} />
                    {r.existingWorkDir ? T.editExistingPersona : T.noWorkDir}
                  </label>
                )}
                {(!r.reuse_project || r.editPersona) ? (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {presets.map((p) => (
                        <Button key={p.id} size="sm" variant="secondary" onClick={() => patchRole(r.key, { persona: p.text })} data-testid={`preset-${idx}-${p.id}`}>
                          {p.name}<span className="opacity-60">· {p.model}</span>{p.new && <Badge variant="info">{T.personaNew}</Badge>}
                        </Button>
                      ))}
                    </div>
                    <Textarea rows={8} value={r.persona} onChange={(e) => patchRole(r.key, { persona: e.target.value })} data-testid={`persona-${idx}`} />
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">{T.replyLang}</label>
                      <select className={selectCls + ' max-w-[12rem]'} value={r.reply_language} onChange={(e) => patchRole(r.key, { reply_language: e.target.value, replyTouched: true })} data-testid={`reply-lang-${idx}`}>
                        {replyLangOptions(r.reply_language).map((c) => <option key={c} value={c}>{langLabel(c)}</option>)}
                      </select>
                    </div>
                  </>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap max-h-48 overflow-auto p-2 rounded bg-gray-50 dark:bg-black/40 text-gray-600 dark:text-gray-400" data-testid={`existing-persona-${idx}`}>
                    {r.existingPersona?.exists ? r.existingPersona.content : T.noPersonaFile}
                  </pre>
                )}
                {(r.reuse_project ? r.existingWorkDir : true) && (
                  <p className="text-[11px] text-gray-400">{T.personaWhere} <code data-testid={`persona-path-${idx}`}>{
                    r.reuse_project
                      ? (r.existingPersona?.path || `${r.existingWorkDir}/${MEMORY_FILE[r.agent_type] || 'AGENTS.md'}`)
                      : `${state?.data_dir || '~/.cc-connect'}/roles/${projectOf(r)}/${MEMORY_FILE[r.agent_type] || 'AGENTS.md'}`
                  }</code></p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 4 fallback role */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300">{T.fallbackQ}</p>
            <div className="space-y-1.5">
              {roles.map((r) => (
                <label key={r.key} className="flex items-center gap-2 text-sm" data-testid={`fallback-${projectOf(r)}`}>
                  <input type="radio" name="fallback" checked={fallback === projectOf(r)} onChange={() => setFallback(projectOf(r))} />
                  {nameOf(r)} <span className="text-gray-400">({projectOf(r)} · {r.agent_type})</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 5 jev */}
        {step === 5 && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{T.jevTitle}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">{T.jevQ}</p>
            <p className="text-xs text-gray-500">{T.jevNoClaude}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input label="Base URL" placeholder="https://api.siliconflow.cn/v1" value={jev.base_url} data-testid="jev-url" onChange={(e) => setJev({ ...jev, base_url: e.target.value.trim() })} />
              <Input label="Key" type="password" value={jev.api_key} data-testid="jev-key" onChange={(e) => setJev({ ...jev, api_key: e.target.value.trim() })} />
              <Input label={T.model} placeholder="Qwen/Qwen3-8B" value={jev.model} data-testid="jev-model" onChange={(e) => setJev({ ...jev, model: e.target.value.trim() })} />
            </div>
            <div className="text-sm" data-testid="jev-status">
              {jevUnchanged && <p className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} />{T.jevInUse}{existingJev?.model} @ {existingJev?.url}</p>}
              {jevTest.running && <p className="text-gray-500 flex items-center gap-1"><Loader2 size={13} className="animate-spin" />{T.jevTesting}</p>}
              {!jevTest.running && jevTest.usable === true && <p className="text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} />{T.jevOK}</p>}
              {!jevTest.running && jevTest.usable === false && (
                <div className="space-y-2">
                  <p className="text-red-500 flex items-center gap-1"><XCircle size={13} />{jevTest.reason}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" data-testid="jev-retry" onClick={() => setJev({ base_url: '', api_key: '', model: '' })}>{T.jevRetry}</Button>
                    <Button size="sm" variant="secondary" data-testid="jev-skip" onClick={() => jevNext('skip')}>{existingJev ? T.jevKeepOld : T.jevSkip}</Button>
                  </div>
                </div>
              )}
              {jevSave.error && <p className="text-red-500">{jevSave.error}</p>}
            </div>
            <p className="text-xs text-gray-500" data-testid="jev-hint">
              {(jevTest.hint && !jevTest.running) ? jevTest.hint : state?.jev_hint}
            </p>
          </div>
        )}

        {/* 6 review / done */}
        {step === 6 && (
          <div className="space-y-3" data-testid="result">
            {!result && (
              <>
                <p className="text-sm text-gray-700 dark:text-gray-300">{T.reviewNote}</p>
                <ul className="text-sm space-y-1">
                  {roles.map((r) => (
                    <li key={r.key}>• {nameOf(r)} → {r.agent_type}{r.useProvider ? ` + ${r.provider.vendor}` : ''}{(!r.reuse_project || r.editPersona) && <span data-testid="review-reply-lang"> · {T.replyLang}: {langLabel(r.reply_language)}</span>}{fallback === projectOf(r) && platform === 'discord' ? <Badge variant="info">{T.fallbackTag}</Badge> : null}</li>
                  ))}
                  {platform === 'discord' && <li>• {guilds.find((g) => g.id === guildID)?.name} / #{channels.find((c) => c.id === channelID)?.name}</li>}
                  {(jevSave.saved || jevUnchanged) && <li>• jev: {jev.model} @ {jev.base_url} ✓ {T.jevStored}</li>}
                </ul>
                {platform === 'discord' && (
                  <div className="space-y-1">
                    <Input label={T.allowFromLabel} value={allowFromValue} data-testid="allow-from" onChange={(e) => setAllowFrom(e.target.value)} />
                    <p className="text-xs text-gray-500">{T.allowFromNote}</p>
                    {!allowFromValue.trim() && <p className="text-xs text-red-500" data-testid="allow-from-missing">{T.allowFromMissing}</p>}
                    {allowFromValue.split(',').some((v) => v.trim() === '*') && <p className="text-xs text-amber-600" data-testid="allow-from-everyone">{T.allowFromEveryone}</p>}
                  </div>
                )}
              </>
            )}
            {result && (result.ok || result.saved) && (
              <div className="space-y-2">
                {result.ok
                  ? <p className="text-emerald-600 font-medium flex items-center gap-1"><CheckCircle2 size={16} />{T.done} {T.doneRestart}</p>
                  : <p className="text-amber-600 font-medium" data-testid="needs-action">{T.savedNeedsAction}</p>}
                {(result.warnings || []).filter((w) => w.blocking).map((w, i) => (
                  <div key={`b${i}`} className="text-sm rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 p-2.5" data-testid={`warning-${w.code}`}>
                    <p className="font-medium text-amber-700 dark:text-amber-400">{w.message}</p>
                    <p className="text-xs text-gray-700 dark:text-gray-300">{w.fix}{w.url && <> <a className="text-accent underline" href={w.url} target="_blank" rel="noreferrer">{T.openLink}</a></>}</p>
                  </div>
                ))}
                {(result.warnings || []).some((w) => !w.blocking && w.code !== 'gate_not_running') && <p className="text-xs text-gray-500">{T.alsoKnow}</p>}
                {(result.warnings || []).filter((w) => !w.blocking && w.code !== 'gate_not_running').map((w, i) => (
                  <p key={`n${i}`} className="text-xs text-amber-600" data-testid={`warning-${w.code}`}>{w.message} {w.fix}</p>
                ))}
                {!result.ok && <p className="text-xs text-gray-500">{T.doneRestart}</p>}
                <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
                  {result.steps.map((s, i) => <li key={i}>{s.ok ? '✓' : '✗'} {s.step}{s.detail ? ` — ${s.detail}` : ''}</li>)}
                </ul>
                {result.roles.filter((r) => r.reply_language).map((r) => (
                  <p key={`l${r.project}`} className="text-xs text-gray-600 dark:text-gray-400" data-testid="reply-lang-saved">{T.replyLangSaved}{r.name} → {langLabel(r.reply_language || '')}</p>
                ))}
                {result.allow_from && <p className="text-xs text-gray-600 dark:text-gray-400" data-testid="allow-from-saved">{T.allowFromSaved}<code>{result.allow_from}</code></p>}
                {result.gate_hint && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.04] rounded-lg p-2.5" data-testid="gate-hint">
                    <p className="font-medium">{T.gateTitle}</p><p>{result.gate_hint}</p>
                  </div>
                )}
                {result.config_backup && <p className="text-xs text-gray-500">{T.backupNote} <code>{result.config_backup}</code></p>}
                <p className="text-xs text-gray-500 bg-gray-50 dark:bg-white/[0.04] rounded-lg p-2.5">{result.jev_hint}</p>
                <Button onClick={async () => { await restartSystem().catch(() => {}); setRestarted(true); }} disabled={restarted}>{restarted ? T.restarted : T.restart}</Button>
              </div>
            )}
            {result && !result.ok && !result.saved && <p className="text-red-500 text-sm">{T.failed}{result.error}</p>}
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500">{T.forAI}</summary>
              <pre className="mt-2 p-2 rounded bg-gray-50 dark:bg-black/40 text-gray-700 dark:text-gray-300 overflow-auto max-h-64" data-testid="ai-command">{`cc-connect setup apply --json - <<'EOF'\n${JSON.stringify(buildRequest(true), null, 2)}\nEOF`}</pre>
              <Button size="sm" variant="ghost" onClick={() => copy('ai', `cc-connect setup apply --json - <<'EOF'\n${JSON.stringify(buildRequest(true), null, 2)}\nEOF`)}><Copy size={12} />{copied === 'ai' ? T.copied : 'Copy'}</Button>
            </details>
          </div>
        )}

        {/* nav */}
        <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-gray-800">
          <Button variant="secondary" onClick={() => go(-1)} disabled={pos === 0 || !!result?.ok || !!result?.saved} data-testid="back">{T.back}</Button>
          {step === 5 && existingJev && <Button variant="danger" size="sm" data-testid="jev-remove" onClick={() => jevNext('remove')}>{T.jevRemove}</Button>}
          {step === 5 && jevTest.usable !== false && <Button variant="ghost" data-testid="jev-skip-nav" onClick={() => jevNext('skip')}>{T.jevSkip}</Button>}
          {step < 6 && <Button onClick={() => (step === 5 ? jevNext() : go(1))} disabled={!stepOK[step]} data-testid="next">{T.next}</Button>}
          {step === 6 && !result?.ok && !result?.saved && <Button onClick={save} disabled={saving || (platform === 'discord' && !allowFromValue.trim())} data-testid="save">{saving ? T.saving : T.save}</Button>}
        </div>
      </Card>
    </div>
  );
}
