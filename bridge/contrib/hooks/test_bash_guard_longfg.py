"""规则 12：主会话前台长命令压 timeout（11-06 #1117）。用 11-05 慢命令真实写法回放。"""
import json, subprocess, os
G = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bash-guard.py")
def run(cmd, timeout=None, sub=False, bg=False, dsh=False):
    inp = {"command": cmd}
    if timeout: inp["timeout"] = timeout
    if bg: inp["run_in_background"] = True
    d = {"tool_name": "Bash", "tool_input": inp, "cwd": "/tmp"}
    if sub: d.update(agent_id="a1", agent_type="general-purpose")
    if dsh: d["dsh"] = True
    out = subprocess.run(["python3", G], input=json.dumps(d), capture_output=True, text=True).stdout
    if "deny" in out: return "deny"
    if "updatedInput" in out: return json.loads(out)["hookSpecificOutput"]["updatedInput"]["timeout"]
    return None
ps1 = "cat > ~/w/add-dsh.ps1 <<'EOF'\nnpm install -g x\nEOF\nssh -o BatchMode=yes sanxin \"powershell -File C:\\\\a.ps1\""
cases = [
  ("ssh 远程装包 600000 压到 290000", run('ssh sanxin "npm i -g @deepseek-ai/dsh 2>&1 && where dsh" 2>&1 | tail -5', 600000), 290000),
  ("heredoc 后 ssh 600000 压到 290000", run(ps1, 600000), 290000),
  ("scp 600000 压到 290000", run("scp -q a.exe sanxin:C:/x.exe", 600000), 290000),
  ("perl alarm 包 ssh 前台 700000 也压", run("perl -e 'alarm shift; exec @ARGV' 600 ssh sanxin \"powershell -File x.ps1\"", 700000), 290000),
  ("deploy.sh 600000 压到 290000", run("cd ~/w && ./deploy.sh vps-arm", 600000), 290000),
  ("ssh 300000 放行", run('ssh sanxin "type C:\\\\x.log"', 300000), None),
  ("ssh 不设 timeout 放行", run('ssh sanxin "dir"'), None),
  ("后台 ssh 带 alarm 放行", run("perl -e 'alarm shift; exec @ARGV' 2400 ssh sanxin \"powershell -File x.ps1\" > l 2>&1", 2500000, bg=True), None),
  ("本地 sed 600000 放行", run("cd ~/w/bridge && sed -i '' 's/a/b/' x.go", 600000), None),
  ("heredoc 正文里的 npm 不算", run("cat > x.ps1 <<'EOF'\nnpm install -g x\nEOF", 600000), None),
  ("子 agent 走规则 10 照样压", run('ssh sanxin "npm i -g x"', 600000, sub=True), 290000),
  ("DSH 不归本条", run('ssh sanxin "dir"', 600000, dsh=True), None),
]
bad = 0
for name, got, want in cases:
    ok = got == want; bad += not ok
    print("ok  " if ok else "FAIL", name, got)
print("全部通过" if not bad else f"{bad} 条失败")
raise SystemExit(bad)
