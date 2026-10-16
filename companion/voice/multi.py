"""Opt-in multi-partner entry point; only reads explicit existing files."""
import argparse
from pathlib import Path

from .app import create_app
from .roles import read_roles, validate_roles
from .settings import Settings


def main():
    parser = argparse.ArgumentParser(description='共栖：选择一位伙伴，轮流语音对话')
    parser.add_argument('--config', type=Path, required=True, help='已准备好的独立实例配置；不会初始化')
    parser.add_argument('--roles', type=Path, required=True, help='明确授权接入的伙伴名单 JSON')
    args = parser.parse_args()
    settings = Settings.read(args.config)
    roles = validate_roles(read_roles(args.roles), settings)
    import uvicorn
    uvicorn.run(create_app(settings, roles=roles), host='127.0.0.1', port=settings.port)


if __name__ == '__main__':
    main()
