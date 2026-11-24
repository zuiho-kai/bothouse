import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/api/client';
import { Button, Card, Input } from '@/components/ui';

const validNumber = /^[a-zA-Z0-9_]{4,24}$/;

export default function FriendSharesPanel({ project }: { project: string }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const title = zh ? '分享给 Agent Arcade 好友' : 'Share with an Agent Arcade friend';
  const endpoint = '/projects/' + encodeURIComponent(project) + '/friend-shares';
  const [numbers, setNumbers] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(false);
    api.get<{ numbers: string[] }>(endpoint).then(data => {
      if (active) setNumbers(data.numbers);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [endpoint, reload]);

  async function change(number: string, share: boolean) {
    setBusy(true);
    try {
      const url = endpoint + '/' + encodeURIComponent(number);
      const data = share ? await api.put<{ numbers: string[] }>(url) : await api.delete<{ numbers: string[] }>(url);
      setNumbers(data.numbers);
      if (share) setInput('');
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!busy && validNumber.test(input.trim())) void change(input.trim(), true);
  }
  return <Card>
    <h3 className="font-semibold">{title}</h3>
    <p className="mt-1 text-sm">{zh ? '从好友的「我」复制准确用户号。保存后，对方可以在通讯录找这个角色聊天或派活。' : 'Copy the exact user number from your friend’s Me page. Once shared, they can find this role in Contacts, chat and assign tasks.'}</p>
    {error ? <div role="alert">{zh ? '无法确认分享名单。' : 'Could not confirm the recipient list.'} <Button onClick={() => setReload(r => r + 1)}>{zh ? '重新读取' : 'Reload'}</Button></div> : <>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <label>{zh ? '好友用户号' : 'Friend’s user number'}<Input value={input} onChange={e => setInput(e.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={zh ? '4–24 位字母、数字或下划线' : '4–24 letters, digits or underscores'} /></label>
        <Button type="submit" disabled={busy || !validNumber.test(input.trim())}>{zh ? '分享角色' : 'Share role'}</Button>
      </form>
      <ul aria-live="polite">{numbers.map(n => <li key={n} className="mt-2 flex items-center gap-3"><span>{n}</span><Button disabled={busy} onClick={() => void change(n,false)} aria-label={(zh ? '撤回分享 ' : 'Revoke share for ') + n}>{zh ? '撤回分享' : 'Revoke share'}</Button></li>)}</ul>
      {numbers.length > 0 && <p className="mt-2 text-xs">{zh ? '撤回仅结束这里的分享。单独授予的项目权限或配对仍按原设置生效。' : 'Revoking removes this share. Separate project permissions and pairings continue to apply.'}</p>}
    </>}
  </Card>;
}
