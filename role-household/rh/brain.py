"""角色大脑：每个角色一份 Claude Code 会话（claude -p + --session-id/--resume）。"""
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
        self._proc: subprocess.Popen | None = None
        self._cancelled = False  # 只有 cancel() 杀的才算打断
        self._mu = threading.Lock()

    def system_prompt(self) -> str:
        return (
            f"{self.role.persona}\n"
            f"你在「角色小家」的内置频道里，和{('、'.join(self.others))}还有用户一起聊用户给的话题。"
            "你说的每句话都会由你的小机器人念出来，所以要像口语聊天：一到三句，不用列表、不用表情符号、"
            "不写动作旁白，不加自己名字前缀。可以接别人的话、反驳或补充，别重复别人说过的。"
        )

    def reply(self, new_messages: str) -> str:
        prompt = f"{new_messages}\n\n轮到你（{self.role.name}）发言了，直接说你要说的话。"
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
        self._started = True
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
