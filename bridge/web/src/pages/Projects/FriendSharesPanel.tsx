import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import api, { ApiError } from '@/api/client';
import { Button, Card, Input } from '@/components/ui';

interface Recipient { number: string; displayName: string; identity: string }

const validNumber = /^[a-zA-Z0-9_]{4,24}$/;

export default function FriendSharesPanel({ project }: { project: string }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const title = zh ? '分享给 Agent Arcade 好友' : 'Share with an Agent Arcade friend';
  const endpoint = '/projects/' + encodeURIComponent(project) + '/friend-shares';
  const [numbers, setNumbers] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [recipient, setRecipient] = useState<Recipient>();
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

  async function change(number: string, confirmed?: Recipient) {
    setBusy(true);
    try {
      const url = endpoint + '/' + encodeURIComponent(number);
      const data = confirmed ? await api.put<{ numbers: string[] }>(url, { identity: confirmed.identity }) : await api.delete<{ numbers: string[] }>(url);
      setNumbers(data.numbers);
      if (confirmed) {
        setInput('');
        setRecipient(undefined);
      }
    } catch {
      if (confirmed) {
        setRecipient(undefined);
        setLookupError(zh ? '未能保存。请重新查找并核对用户。' : 'Share not saved. Look up and confirm the account again.');
      } else {
        setError(true);
      }
    }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const number = input.trim();
    if (busy || !validNumber.test(number)) return;
    setBusy(true);
    setRecipient(undefined);
    setLookupError('');
    try {
      setRecipient(await api.get<Recipient>(endpoint + '/' + encodeURIComponent(number)));
    } catch (error) {
      const missing = error instanceof ApiError && error.status === 404;
      setLookupError(missing
        ? (zh ? '找不到这个已注册的用户号。' : 'No registered account has this user number.')
        : (zh ? '暂时无法核对好友用户号，请检查好友服务后重试。' : 'Could not verify the account. Check the Friends service and try again.'));
    } finally {
      setBusy(false);
    }
  }
  return <Card>
    <h3 className="font-semibold">{title}</h3>
    <p className="mt-1 text-sm">{zh ? '从好友的「我」复制准确用户号。保存后，对方可以在通讯录找这个角色聊天或派活。' : 'Copy the exact user number from your friend’s Me page. Once shared, they can find this role in Contacts, chat and assign tasks.'}</p>
    {error ? <div role="alert">{zh ? '无法确认分享名单。' : 'Could not confirm the recipient list.'} <Button onClick={() => setReload(r => r + 1)}>{zh ? '重新读取' : 'Reload'}</Button></div> : <>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
        <label>{zh ? '好友用户号' : 'Friend’s user number'}<Input value={input} onChange={e => { setInput(e.target.value); setRecipient(undefined); setLookupError(''); }} disabled={busy} autoCapitalize="none" autoComplete="off" spellCheck={false} placeholder={zh ? '4–24 位字母、数字或下划线' : '4–24 letters, digits or underscores'} /></label>
        <Button type="submit" disabled={busy || !validNumber.test(input.trim())}>{zh ? '查找好友' : 'Find friend'}</Button>
      </form>
      {lookupError && <p role="alert" className="mt-2 text-sm">{lookupError}</p>}
      {recipient && <div className="mt-3 flex flex-wrap items-center gap-3" aria-live="polite">
        <span>{recipient.displayName} · {recipient.number}</span>
        <Button disabled={busy} onClick={() => void change(recipient.number, recipient)}>{zh ? '确认分享角色' : 'Confirm role share'}</Button>
      </div>}
      <ul aria-live="polite">{numbers.map(n => <li key={n} className="mt-2 flex items-center gap-3"><span>{n}</span><Button disabled={busy} onClick={() => void change(n)} aria-label={(zh ? '撤回分享 ' : 'Revoke share for ') + n}>{zh ? '撤回分享' : 'Revoke share'}</Button></li>)}</ul>
      {numbers.length > 0 && <p className="mt-2 text-xs">{zh ? '撤回仅结束这里的分享。单独授予的项目权限或配对仍按原设置生效。' : 'Revoking removes this share. Separate project permissions and pairings continue to apply.'}</p>}
    </>}
  </Card>;
}
