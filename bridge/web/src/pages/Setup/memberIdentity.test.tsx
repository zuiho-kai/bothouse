import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SetupWizard from './SetupWizard';
import { wizardTexts } from './texts';
import { nextRoleName, roleLabel } from '@/lib/roleIdentity';

const setupFixture = vi.hoisted(() => ({ projects: ['codex'] as string[], displayNames: [] as string[] }));
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh', changeLanguage: vi.fn() } }) }));
vi.mock('@/components/library', () => ({
 useLibrary: () => ({ lib: { personas: [] }, reload: vi.fn() }),
 PersonaLibrary: ({onPick}: {onPick: (p: unknown) => void}) => <button data-testid="pick-fixture" onClick={() => onPick({slug:'dragon',name:'龙娘',text:'# 角色：龙娘\n\n你是「龙娘」。认真工作。'})}>选人设</button>,
}));
vi.mock('@/api/wizard', async (original) => ({
 ...await original<object>(),
 getSetupState: async () => ({ projects: setupFixture.projects, project_display_names: setupFixture.displayNames, setup: {}, gate_enabled: false }),
 getCLIs: async () => ({ clis: [{agent_type:'codex',label:'Codex',supported:true,login:'logged_in'}, {agent_type:'claudecode',label:'Claude Code',supported:true,login:'logged_in'}] }),
 getMatrix: async () => ({vendors:[],matrix:[]}), getExistingBots: async () => ({bots:[]}),
 getLocalHub: async () => ({running:true,token_known:true,url:'http://fixture.invalid',managed:true}),
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); container?.remove(); setupFixture.projects = ['codex']; setupFixture.displayNames = []; });
const click = async (selector: string) => { const el=container.querySelector<HTMLButtonElement>(selector); expect(el).not.toBeNull(); await act(async()=>el!.click()); };
const input = async (selector: string, value: string) => { const el=container.querySelector<HTMLInputElement>(selector)!; await act(async()=> { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value); el.dispatchEvent(new Event('input',{bubbles:true})); }); };
const next = async () => { const button=[...container.querySelectorAll('button')].find(b=>b.textContent===wizardTexts('zh').next)!; expect(button.disabled).toBe(false); await act(async()=>button.click()); };

describe('member naming in both setup entry points', () => {
 for(const path of ['/setup','/setup?add=1']) it(path+' keeps backend names and makes persona optional',async()=>{
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<MemoryRouter initialEntries={[path]}><SetupWizard/></MemoryRouter>));
  await click('[data-testid="platform-cloud_web"]'); await next(); await next();
  expect(container.querySelector<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('Codex-2');
  await input('[data-testid="role-name-0"]','小码');
  await click('[data-testid="cli-0-claudecode"]');
  expect(container.querySelector('[data-testid="role-label-0"]')?.textContent).toBe('小码·Claude Code');
  await next();
  const details=container.querySelector<HTMLDetailsElement>('[data-testid="optional-persona-0"]')!;
  expect(details.open).toBe(false);
  expect(container.querySelector<HTMLTextAreaElement>('[data-testid="persona-0"]')?.value).toBe('');
  await act(async()=>{details.open=true}); await click('[data-testid="pick-fixture"]');
  expect(container.querySelector<HTMLTextAreaElement>('[data-testid="persona-0"]')?.value).toBe('# 角色：小码\n\n你是「小码」。认真工作。');
 });
 it('numbers duplicates without repeating the backend label',()=>{
  expect(nextRoleName('codex',['Codex','Codex-2'])).toBe('Codex-3');
  expect(roleLabel('Codex','codex')).toBe('Codex');
 });
 it('does not reserve a project id whose display name is different',async()=>{
  setupFixture.displayNames = ['小码'];
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<MemoryRouter initialEntries={['/setup']}><SetupWizard/></MemoryRouter>));
  await click('[data-testid="platform-cloud_web"]'); await next(); await next();
  expect(container.querySelector<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('Codex');
 });
 it('numbers an added role after configured project ids as well as display names',async()=>{
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root!.render(<MemoryRouter initialEntries={['/setup?add=1']}><SetupWizard/></MemoryRouter>));
  await click('[data-testid="platform-cloud_web"]'); await next();
  await click('[data-testid="cw-add-role"]'); await next();
  expect(container.querySelector<HTMLInputElement>('[data-testid="role-name-0"]')?.value).toBe('Codex-2');
  expect(container.querySelector<HTMLInputElement>('[data-testid="role-name-1"]')?.value).toBe('Codex-3');
 });
});
