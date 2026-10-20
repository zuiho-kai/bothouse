"""角色大脑：每个角色一份 Claude Code 会话（claude -p + --session-id/--resume）。

会话 id 存在会话目录的 session.json（6 周清单第⑥项「会话 id 落盘到 data/，重启 --resume」）：
主机重启、频道恢复后新建的大脑读到它就用 --resume 接着同一个会话。一个频道一个会话目录
（rh/host.py room_session_dir），所以频道之间不共用会话。首次调用成功才写；存着的会话在 claude 那边
已经没了（No conversation found）就开一个新会话再答一次。"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
import uuid
from pathlib import Path

from .config import Role


class Cancelled(Exception):
    pass


# 角色这一轮不说话时只输出它：主机不发消息、不出声（rh/meeting.py）。
# 来源：用户 2026-10-19「首先就是重复的太多了」；橘裁决“每个角色轮到时可以选择不说话”，标记是实现者定的。
PASS = "【跳过】"
SESSION_FILE = "session.json"   # 会话目录里存会话 id 的文件。来源：实现者定。


class ClaudeBrain:
    def __init__(self, role: Role, others: list[str], model: str, timeout: float, workdir: Path):
        self.role = role
        self.others = others
        self.model = model
        self.timeout = timeout
        self.workdir = workdir
        self.workdir.mkdir(parents=True, exist_ok=True)
        self.session_id = str(uuid.uuid4())
        self._started = False
        saved = self._load_session()
        if saved:
            self.session_id, self._started = saved, True
        self._proc: subprocess.Popen | None = None
        self._cancelled = False  # 只有 cancel() 杀的才算打断
        self._mu = threading.Lock()

    def system_prompt(self) -> str:
        return (
            f"{self.role.persona}\n"
            f"你在「角色小家」的内置频道里，和{('、'.join(self.others))}还有用户一起聊用户给的话题。"
            "你说的每句话都会由你的小机器人念出来，所以要像口语聊天：一到三句，不用列表、不用表情符号、"
            "不写动作旁白，不加自己名字前缀。可以接别人的话、反驳或补充，别重复别人说过的。"
            f"轮到你时如果没有新东西可说——别人已经说过差不多的意思，或者话题已经收尾（用户说了没事了、"
            f"已经有人道过晚安或再见）——就只输出{PASS}，这一轮你不出声，不要再跟着说一遍晚安、再见或客套话。"
        )

    @property
    def session_file(self) -> Path:
        return self.workdir / SESSION_FILE

    def _load_session(self) -> str | None:
        try:
            sid = json.loads(self.session_file.read_text())["session_id"]
            return str(uuid.UUID(sid))
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _save_session(self) -> None:
        tmp = self.session_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"session_id": self.session_id}))
        tmp.replace(self.session_file)

    def reply(self, new_messages: str) -> str:
        try:
            return self._reply(new_messages)
        except RuntimeError as e:
            if not (self._started and "No conversation found" in str(e)):
                raise
        # 存着的会话在 claude 那边没了：开新会话，再答一次。
        self.session_id, self._started = str(uuid.uuid4()), False
        return self._reply(new_messages)

    def _reply(self, new_messages: str) -> str:
        # 不写“轮到你（名字）发言了”：和历史里的说话人格式凑在一起，模型会回“名字发言：……”。
        prompt = (f"{new_messages}\n\n轮到你了。只输出你要说的话本身，开头不要带你的名字、冒号或引号；"
                  f"没有新东西可说就只输出{PASS}。")
        cmd = ["claude", "-p", "--safe-mode", "--model", self.model, "--tools", "",
               "--strict-mcp-config", "--output-format", "json"]
        if self._started:
            cmd += ["--resume", self.session_id]
        else:
            cmd += ["--session-id", self.session_id, "--system-prompt", self.system_prompt()]
        try:
            text = self._run(cmd, prompt)
        except BaseException:
            if not self._started:
                # 首次调用没成功（打断、超时、出错都算），会话文件可能已经建了，
                # 再用同一个 --session-id 会报 "already in use"；换新 id 下次重新开。
                self.session_id = str(uuid.uuid4())
            raise
        if not self._started:
            self._started = True
            self._save_session()
        return text

    def _run(self, cmd: list[str], prompt: str) -> str:
        # 起进程前先编码：编码失败（如落单代理字符）不能发生在进程起来之后，否则 claude 会卡在等 stdin。
        data_in = prompt.encode("utf-8", "replace")
        with self._mu:
            self._cancelled = False
            # prompt 走 stdin，不进 argv：避免 NUL 字节和超长参数（E2BIG）让 Popen 必然失败。
            # 新进程组：打断/超时时用 killpg 连同 claude 派生的子进程一起杀，防止管道一直不 EOF。
            proc = subprocess.Popen(cmd, cwd=self.workdir, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, stdin=subprocess.PIPE,
                                    start_new_session=True)
            self._proc = proc
        try:
            try:
                out_b, err_b = proc.communicate(data_in, timeout=self.timeout)
            except subprocess.TimeoutExpired:
                _killpg(proc)
                try:
                    proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    pass
                raise RuntimeError(f"{self.role.name}: claude 超时")
        finally:
            with self._mu:
                self._proc = None
                cancelled = self._cancelled
        out = out_b.decode("utf-8", "replace")
        err = err_b.decode("utf-8", "replace")
        if cancelled and proc.returncode < 0:
            raise Cancelled()
        # cancel 碰上“刚好生成完”：进程已正常退出，回复照常返回，由 meeting 按“没说出去”处理。
        if proc.returncode < 0:
            # 不是我们打断的（OOM、外部 kill），当错误报给频道，不能悄悄停。
            raise RuntimeError(f"{self.role.name}: claude 被信号 {-proc.returncode} 杀掉")
        if proc.returncode != 0:
            raise RuntimeError(f"{self.role.name}: claude 退出码 {proc.returncode}: {err[-300:]}")
        data = json.loads(out)
        if data.get("is_error"):
            raise RuntimeError(f"{self.role.name}: {data.get('result')}")
        return str(data["result"]).strip()

    def cancel(self) -> None:
        with self._mu:
            # 只杀还在跑的进程：已退出的不再 killpg（pid 回收后可能被别的进程组复用）。
            if self._proc is not None and self._proc.poll() is None:
                self._cancelled = True
                _killpg(self._proc)


def _killpg(proc: subprocess.Popen) -> None:
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
