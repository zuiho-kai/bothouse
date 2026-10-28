"""Device mode state on the 8796 side: a persisted mirror of the board's NVS.

The board is the single source of truth; this store only remembers the last
mode each device reported so a reconnect, a gateway restart, or a turn submitted
without a mode can still route correctly. Every applied change records the
operation identity that asked for it.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

from .modes import MODES, DEFAULT_MODE


class ModeStore:
    def __init__(self, path: Path, default_mode: str = DEFAULT_MODE):
        if default_mode not in MODES:
            raise ValueError(f'未知默认语音模式：{default_mode}')
        self.path = Path(path).expanduser()
        self.default_mode = default_mode
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._modes: dict[str, dict] = self._read()

    def _read(self) -> dict[str, dict]:
        if not self.path.is_file():
            return {}
        data = json.loads(self.path.read_text(encoding='utf-8'))
        if not isinstance(data, dict):
            raise ValueError('设备模式文件必须是 JSON 对象。')
        devices = data.get('devices')
        if not isinstance(devices, dict):
            raise ValueError('设备模式文件缺少 devices。')
        clean = {}
        for device_id, row in devices.items():
            if isinstance(row, dict) and row.get('mode') in MODES:
                clean[device_id] = row
        return clean

    def _write(self) -> None:
        tmp = self.path.with_suffix(self.path.suffix + '.tmp')
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump({'version': 1, 'devices': self._modes}, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, self.path)

    def get(self, device_id: str) -> str:
        row = self._modes.get(device_id)
        return row['mode'] if row else self.default_mode

    def snapshot(self, device_id: str) -> dict:
        row = self._modes.get(device_id)
        return {'mode': row['mode'] if row else self.default_mode,
                'modes': list(MODES),
                'operation_id': row.get('operation_id', '') if row else '',
                'updated_at': row.get('updated_at', '') if row else ''}

    def set(self, device_id: str, mode: str, operation_id: str) -> dict:
        if mode not in MODES:
            raise ValueError(f'未知语音模式：{mode}')
        if not operation_id.strip():
            raise ValueError('模式变更需要操作身份。')
        previous = self.get(device_id)
        self._modes[device_id] = {
            'mode': mode,
            'operation_id': operation_id,
            'updated_at': datetime.now(timezone.utc).isoformat(),
        }
        self._write()
        return {'mode': mode, 'previous': previous, 'changed': mode != previous,
                'operation_id': operation_id}
