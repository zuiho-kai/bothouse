# 交活时指定工作区这件活的模型和推理强度（#2075，用户 11-22「改不了怎么指挥工作区切不同模型应对不同难度的问题呢」）。
# 用的是桥现有的切模型（<桥> model list / model set，core/model_command.go）：交活前按本项目的模型列表核对，
# 不在列表里就报错并列出可选项；交给工作区时 model set --handoff 排到工作区下一轮生效，工作区放回时桥换回它原来的
# 模型（core/session_model_scope.go QueueHandoffModelSwitch / restoreHandoffModels）。
import json, os, subprocess

import _team


def parse(argv):
    """从参数里取出 --model <id> 和 --effort <级别>，返回（剩下的参数，模型，强度）；没写的是 None。"""
    out, model, effort = [], None, None
    i = 0
    while i < len(argv):
        if argv[i] in ("--model", "--effort") and i + 1 < len(argv):
            if argv[i] == "--model":
                model = argv[i + 1].strip()
            else:
                effort = argv[i + 1].strip()
            i += 2
            continue
        out.append(argv[i])
        i += 1
    return out, model, effort


def label(model, effort):
    return " ".join(x for x in (model, effort) if x)


def check(model, effort, project=None, session=None):
    """模型 id 要在本项目 `model list` 里（工作区跑的就是本项目的 agent），强度要在它支持的级别里；
    不对返回一句带可选项的报错，对了返回 None。"""
    if not model and not effort:
        return None
    if not model:
        return "--effort 要和 --model 一起写（交活用法：--model <id> [--effort <级别>]）"
    cc = _team.cc_bin()
    if not cc:
        return "找不到桥程序（CC_BIN / bothouse / cc-connect），没法核对模型"
    cmd = [cc, "model", "list", "--json", "--project", project or _team.project()]
    sk = session or os.environ.get("CC_SESSION_KEY") or ""
    if sk:
        cmd += ["--session-key", sk]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        st = json.loads(r.stdout)
    except ValueError:
        return f"查模型列表失败：{(r.stderr or r.stdout).strip()}"
    names = [m.get("Name", "") for m in st.get("models") or []]
    if model and model not in names:
        return (f"模型 {model} 不在本项目的模型列表里，没交。可选：{'、'.join(names) or '（列表为空）'}"
                "（照抄其中一个 id，不要别名或近似写法）")
    levels = st.get("efforts") or []
    if effort and levels and effort.lower() not in [x.lower() for x in levels]:
        return f"推理强度 {effort} 不支持，没交。可选：{'、'.join(levels)}"
    if effort and not levels and st.get("effort_in_model"):
        return "这个项目的推理强度写在模型 id 里，没交：不写 --effort，换成带这档强度的模型 id"
    return None


def apply(ws_key, model, effort, project=None):
    """给工作区会话排上这件活的模型（下一轮生效，工作区放回时桥换回原来的）。成功返回 None，失败返回原因。"""
    if not model:
        return None
    cmd = [_team.cc_bin() or "cc-connect", "model", "set", model, "--handoff",
           "--project", project or _team.project(), "--session-key", ws_key, "--json"]
    if effort:
        cmd += ["--effort", effort]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        res = json.loads(r.stdout)
    except ValueError:
        res = {}
    if r.returncode != 0 or not res.get("ok"):
        return res.get("message") or (r.stderr or r.stdout).strip() or f"model set 退出码 {r.returncode}"
    return None
