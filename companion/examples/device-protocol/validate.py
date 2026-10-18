#!/usr/bin/env python3
"""Offline check that the sanitized samples still match the protocol schema.

Only the small JSON Schema subset used by ``schema.json`` is implemented, so
this runs with the standard library and no extra dependency:

    python examples/device-protocol/validate.py

Exit code 0 means every sample validates; 1 prints the first errors.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TYPES = {
    'object': dict, 'array': list, 'string': str, 'boolean': bool,
    'integer': int, 'number': (int, float), 'null': type(None),
}


def check(value, schema, root, path='$'):
    errors = []
    if '$ref' in schema:
        name = schema['$ref'].rsplit('/', 1)[-1]
        return check(value, root['$defs'][name], root, path)
    expected = schema.get('type')
    if expected is not None:
        names = expected if isinstance(expected, list) else [expected]
        if not any(isinstance(value, TYPES[name]) and not (name in {'integer', 'number'} and isinstance(value, bool))
                   for name in names):
            return [f'{path}: 期望 {expected}，实际 {type(value).__name__}']
    if 'const' in schema and value != schema['const']:
        errors.append(f'{path}: 必须等于 {schema["const"]!r}')
    if 'enum' in schema and value not in schema['enum']:
        errors.append(f'{path}: {value!r} 不在 {schema["enum"]}')
    if isinstance(value, str):
        if 'minLength' in schema and len(value) < schema['minLength']:
            errors.append(f'{path}: 长度小于 {schema["minLength"]}')
        if 'pattern' in schema and not re.fullmatch(schema['pattern'], value):
            errors.append(f'{path}: 不符合 {schema["pattern"]}')
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if 'minimum' in schema and value < schema['minimum']:
            errors.append(f'{path}: 小于 {schema["minimum"]}')
    if isinstance(value, dict):
        for key in schema.get('required', []):
            if key not in value:
                errors.append(f'{path}: 缺少字段 {key}')
        properties = schema.get('properties', {})
        for key, item in value.items():
            if key in properties:
                errors.extend(check(item, properties[key], root, f'{path}.{key}'))
            elif schema.get('additionalProperties') is False:
                errors.append(f'{path}: 不允许字段 {key}')
    if isinstance(value, list) and 'items' in schema:
        for index, item in enumerate(value):
            errors.extend(check(item, schema['items'], root, f'{path}[{index}]'))
    return errors


def main() -> int:
    schema = json.loads((ROOT / 'schema.json').read_text(encoding='utf-8'))
    samples = json.loads((ROOT / 'samples.json').read_text(encoding='utf-8'))
    errors = check(samples, schema, schema)
    if errors:
        print('\n'.join(errors))
        return 1
    print(f'{len(samples)} 条样例通过校验：{", ".join(sorted(samples))}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
