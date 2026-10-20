import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Save } from 'lucide-react';
import { Button, Card, Textarea } from '@/components/ui';
import { getPersonas, getProjectPersona, saveProjectPersona, type PersonaPreset } from '@/api/wizard';
import { isZhLang } from '@/pages/Setup/texts';

/** Persona of a running role: the agent's instruction file (CLAUDE.md / AGENTS.md / …) —
 *  the same file the setup wizard wrote, `/memory` edits in chat, and the folder holds. */
export default function PersonaPanel({ project }: { project: string }) {
  const { i18n } = useTranslation();
  const zh = isZhLang(i18n.language || 'en');
  const [path, setPath] = useState('');
  const [content, setContent] = useState('');
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getProjectPersona(project).then((r) => { setPath(r.path); setContent(r.content); }).catch((e) => setError(e?.message || String(e)));
    getPersonas(zh ? 'zh' : 'en').then((r) => setPresets(r.presets)).catch(() => {});
  }, [project, zh]);

  const save = async () => {
    setError('');
    try { await saveProjectPersona(project, content); setSaved(true); window.setTimeout(() => setSaved(false), 1500); } // 来源：“已保存”提示停留时间，纯界面
    catch (e: any) { setError(e?.message || String(e)); }
  };

  return (
    <Card className="space-y-3" data-testid="persona-panel">
      <p className="text-xs text-gray-500">
        {zh ? '这里、在聊天里叫机器人改、直接改文件夹里的文件，三种改的是同一个文件：' : 'Here, in chat, or in the folder — all three edit the same file:'} <code>{path}</code>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {presets.map((p) => (
          <Button key={p.id} size="sm" variant="secondary" onClick={() => setContent(p.text)}>{p.name}<span className="opacity-60">· {p.model}</span></Button>
        ))}
      </div>
      <Textarea rows={16} value={content} onChange={(e) => setContent(e.target.value)} data-testid="persona-editor" />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={save} data-testid="persona-save">{saved ? <Check size={14} /> : <Save size={14} />}{zh ? '保存' : 'Save'}</Button>
        <span className="text-xs text-gray-400">{zh ? '下一轮对话生效。' : 'Takes effect from the next turn.'}</span>
      </div>
    </Card>
  );
}
