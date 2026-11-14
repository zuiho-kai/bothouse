"""Codex payloads through the installed run.py entry, no real commands executed."""
import json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
RUN=Path(__file__).with_name('run.py')
class CodexHooks(unittest.TestCase):
 def run_hook(self,name,payload):
  r=subprocess.run([sys.executable,'-I',str(RUN),'--codex',name],input=json.dumps(payload),capture_output=True,text=True,timeout=10)
  self.assertEqual(r.returncode,0,r.stderr)
  return json.loads(r.stdout) if r.stdout.strip() else {}
 def test_shell_command_normalized_and_blocked(self):
  out=self.run_hook('bash-guard',{'hook_event_name':'PreToolUse','tool_name':'exec_command','tool_input':{'cmd':'sleep 120'}})
  self.assertEqual(out['hookSpecificOutput']['permissionDecision'],'deny')
  self.assertEqual(self.run_hook('bash-guard',{'hook_event_name':'PreToolUse','tool_name':'Bash','tool_input':{'command':'echo harmless'}}),{})
 @unittest.skip("#1627 第 16 批：措辞守卫已删，Stop 管道要换一个不靠 promise-guard 的夹具")
 def test_stop_rollout_prompt_and_table(self):
  with tempfile.TemporaryDirectory() as d:
   path=Path(d)/'rollout.jsonl'
   def message(role,text):return {'type':'response_item','payload':{'type':'message','role':role,'content':[{'type':'input_text' if role=='user' else 'output_text','text':text}]}}
   path.write_text(json.dumps(message('user','修一下这个 bug'))+'\n'+json.dumps(message('assistant','已修复'))+'\n')
   p={'hook_event_name':'Stop','transcript_path':str(path),'last_assistant_message':'已修复'}
   # #1527：入口表检查删了，「已修复」不再拦；Stop 管道改用 promise-guard 验（下一步没派出去就拦）
   self.assertEqual(self.run_hook('fix-claim-guard',p),{})
   q=dict(p,last_assistant_message='下一步我去改路由')
   self.assertEqual(self.run_hook('promise-guard',q)['decision'],'block')
   self.assertEqual(self.run_hook('promise-guard',dict(q,stop_hook_active=True)),{})
if __name__=='__main__':unittest.main()
