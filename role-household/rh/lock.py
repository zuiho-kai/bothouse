"""会议发言锁：全局一把，先到先得；人说话即打断当前角色并释放锁。

规则来源：~/wiki/ai/jiuwen/jiuwen-duplex.md「关键事实」。
"""
from __future__ import annotations

import threading


class SpeakingLock:
    def __init__(self) -> None:
        self._mu = threading.Lock()
        self._holder: str | None = None
        self._token = 0
        self._cancel: threading.Event | None = None

    @property
    def holder(self) -> str | None:
        return self._holder

    def try_acquire(self, who: str) -> tuple[int, threading.Event] | None:
        """先到先得：锁空闲就拿到，返回 (token, 打断事件)；被占用返回 None，不排队。"""
        with self._mu:
            if self._holder is not None:
                return None
            self._token += 1
            self._holder = who
            self._cancel = threading.Event()
            return self._token, self._cancel

    def release(self, who: str, token: int) -> bool:
        """正常说完释放。token 不匹配（已被打断）就什么也不做。"""
        with self._mu:
            if self._holder != who or self._token != token:
                return False
            self._holder = None
            self._cancel = None
            return True

    def interrupt(self) -> str | None:
        """人说话：打断当前在说的角色，立即释放锁。返回被打断的角色。"""
        with self._mu:
            who, ev = self._holder, self._cancel
            self._holder = None
            self._cancel = None
            self._token += 1
        if ev is not None:
            ev.set()
        return who
