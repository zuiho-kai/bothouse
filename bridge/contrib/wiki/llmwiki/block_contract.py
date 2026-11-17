"""Lossless structure operations over immutable Git sources (product pipeline).

The model proposes addresses, never bytes of moved facts. Exact source quotes
establish provenance, not natural-language truth. Optional human review binds
supersession to the complete proposed final tree.
"""
import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
import tarfile

import posixpath


TRAILER = 'Wiki-Block-Coverage: '
PLAN_PREFIX = 'Wiki-Blocks: '
# Source: existing ignored .ingest-work/ namespace, also present in legacy trees.
CATALOG = '.ingest-work/block-sources.json'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def git(repo, *args, data=None):
    return subprocess.run(['git', *args], cwd=repo, input=data, capture_output=True, check=True).stdout


def revision(repo, sha):
    return git(repo, 'rev-parse', '--verify', '--end-of-options', sha + '^{commit}').decode().strip()


def tree(repo, sha):
    """Read Markdown without checkout, extraction, hooks or model execution."""
    raw = git(repo, 'archive', revision(repo, sha))
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        return {m.name: archive.extractfile(m).read().decode() for m in archive.getmembers()
                if m.isfile() and m.name.endswith('.md') and not any(p.startswith('.') for p in Path(m.name).parts)
                and Path(m.name).parts[0] not in ('bin', 'tests', 'schema', 'launchd')}


def working_tree(root):
    result = {}
    for path in root.rglob('*.md'):
        rel = path.relative_to(root)
        if any(p.startswith('.') for p in rel.parts) or rel.parts[0] in ('bin', 'tests', 'schema', 'launchd'):
            continue
        if path.is_symlink() or any((root / parent).is_symlink() for parent in rel.parents):
            raise ValueError('block coverage: wiki files and domains must not be symlinks')
        result[rel.as_posix()] = path.read_text(encoding='utf-8')
    return result


def pages(files, indexed=False):
    """Follow the product's MEMORY → nested README indexes, including archived links.

    Inventory includes orphan topics too: deleting their index must not erase facts.
    Like search.py, root files and README navigation are not memory topic pages.
    """
    indexes = {p for p in files if p.endswith('/README.md') and not p.startswith(('.', 'bin/'))}
    reachable = set()
    if indexed:
        todo = ['MEMORY.md']
        while todo:
            path = todo.pop()
            if path in reachable:
                continue
            reachable.add(path)
            for link in re.findall(r'\]\(([^)#]+)(?:#[^)]*)?\)', files.get(path, '')):
                target = posixpath.normpath(posixpath.join(posixpath.dirname(path), link))
                if target in files and not target.startswith(('../', '/')):
                    if target in indexes:
                        todo.append(target)
                    else:
                        reachable.add(target)
    return {p: t for p, t in files.items() if '/' in p and not p.endswith('/README.md') and
            posixpath.dirname(p) + '/README.md' in indexes and
            (not indexed or p in reachable)}


def blocks(path, text):
    """A top-level bullet with its children, or a contiguous prose paragraph.

    Only YAML frontmatter, H1/H2 headings and blank separators are structure.
    Fences, continuations and subheadings inside a block remain original text.
    """
    lines = text.splitlines(keepends=True)
    start = 0
    if lines and lines[0].strip() == '---':
        for number, line in enumerate(lines[1:], 1):
            if line.strip() == '---':
                start = number + 1
                break
    result, current, section, fenced = [], [], '', False
    occurrence = Counter()
    def flush():
        if not current:
            return
        raw = ''.join(line for _, line in current).rstrip('\n')
        identity = (path, section, raw)
        occurrence[identity] += 1
        result.append(dict(id=digest([*identity, occurrence[identity]]), path=path, section=section,
                           line=current[0][0], text=raw))
        current.clear()
    for number, line in enumerate(lines[start:], start + 1):
        if not fenced and (line.startswith('# ') or line.startswith('## ')):
            flush()
            section = line.rstrip('\n') if line.startswith('## ') else ''
        elif not fenced and (not line.strip() or (Path(path).name == 'README.md' and re.match(r'\s*- \[.*?\]\(', line))):
            flush()
        else:
            if not fenced and re.match(r'(?:- |\* |\+ |\d+[.)] )', line):
                flush()
            current.append((number, line))
            if line.lstrip().startswith((chr(96) * 3, '~~~')):
                fenced = not fenced
    flush()
    return result


def inventory(repo, sources):
    by_id, snapshots = {}, []
    for sha in sources:
        rows = [row for path, text in pages(tree(repo, sha)).items() for row in blocks(path, text)]
        snapshots.append(rows)
        for row in rows:
            by_id.setdefault(row['id'], row)
    return by_id, snapshots


def freeze(repo, sources, source=''):
    commits = list(dict.fromkeys(revision(repo, sha) for sha in sources))
    for sha in commits:
        # Source: pending snapshots may be amended; both conflict sides need durable source refs.
        git(repo, 'update-ref', 'refs/wiki-ingest/sources/' + sha, sha)
    blob = git(repo, 'hash-object', '-w', '--stdin', data=(source or '').encode()).decode().strip()
    git(repo, 'update-ref', 'refs/wiki-ingest/source-inputs/' + blob, blob)
    return dict(sources=commits, input=blob, plan=dict(moves=[], updates=[]))


def catalog(repo, root, coverage):
    by_id, _ = inventory(repo, coverage['sources'])
    path = root / CATALOG
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(canonical(dict(sources=coverage['sources'], blocks=list(by_id.values()),
                                  plan=coverage['plan'])) + '\n', encoding='utf-8')


INSTRUCTION = '''
LOSSLESS BLOCK CONTRACT (overrides instructions to rewrite old facts):
Read .ingest-work/block-sources.json for immutable old block IDs, locations and original text.
Leave existing fact blocks intact. You may append new facts and prepare page frontmatter,
H1/H2 headings, domain indexes and log entries. To split/move, do NOT rewrite or copy old facts.
Return exactly one line before the final Wiki-Capacity line:
Wiki-Blocks: {"moves":[{"block":"catalog ID","to":"domain/topic.md","section":"## Key facts"}],"updates":[]}
Use the actual language/schema section heading. The program reads original bytes and executes moves.
Use empty lists when no moves/updates are needed. Old blocks absent from a searchable topic/archive
are rejected regardless of additions or net line count. Pure splitting may not add or change facts.
On correction/resume, keep all still-applicable operations from the catalog's saved plan.
For a factual update, use an updates entry with block, to, section, text (one complete replacement
block), source {line: exact line number in the original TRANSCRIPT, quote: that exact line},
and reason (the explicit supersession relation). Updates cannot be hidden in a move.
The program validates exact source quotes, supersession reasons and the complete final tree.
Valid updates are delivered automatically together with new facts and checkpoint progress.
Preserve both sides of a conflict; a newer-looking value alone never proves supersession.
'''


def instruction(review_required=False):
    if not review_required:
        return INSTRUCTION
    return INSTRUCTION.replace(
        'Valid updates are delivered automatically together with new facts and checkpoint progress.',
        'An independent reviewer must approve the exact final tree before delivery. '
        'Unapproved updates remain pending with offsets unchanged.')


def plan_output(output):
    lines = [line for line in output.splitlines() if line.startswith(PLAN_PREFIX)]
    if not lines:
        return dict(moves=[], updates=[])  # legacy appends still undergo complete coverage
    if len(lines) != 1:
        raise ValueError('block plan: expected exactly one Wiki-Blocks line')
    plan = json.loads(lines[0][len(PLAN_PREFIX):])
    if not isinstance(plan, dict) or set(plan) != {'moves', 'updates'}:
        raise ValueError('block plan: expected moves and updates lists')
    if not all(isinstance(plan[k], list) for k in plan):
        raise ValueError('block plan: moves and updates must be lists')
    return plan


def remove_block(text, row):
    lines = text.splitlines(keepends=True)
    first = row['line'] - 1
    stop = first + len(row['text'].splitlines())
    return ''.join(lines[:first] + lines[stop:])


def append_block(text, section, raw):
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if line.rstrip('\n') == section]
    if len(starts) != 1 or not section.startswith('## '):
        raise ValueError('block plan: destination requires exactly one existing H2 section')
    stop = next((i for i in range(starts[0] + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
    before = ''.join(lines[:stop])
    return before.rstrip('\n') + '\n' + raw + '\n' + ''.join(lines[stop:])


def render(repo, coverage, files, kind):
    """Validate the entire plan, then render in memory; no partial writes on failure."""
    result = dict(files)
    by_id, snapshots = inventory(repo, coverage['sources'])
    plan, seen = coverage['plan'], set()
    source = git(repo, 'cat-file', 'blob', coverage['input']).decode().splitlines()
    destinations = pages(files, indexed=True)
    # Source: frozen snapshots are alternative versions, not additive copies.
    location = lambda row: (row['path'], row['section'], row['text'])
    expected = Counter()
    for snapshot in snapshots:
        expected |= Counter(location(row) for row in snapshot)
    affected = set()
    for operation in ('moves', 'updates'):
        for intent in plan[operation]:
            if not isinstance(intent, dict) or intent.get('block') not in by_id or intent['block'] in seen:
                raise ValueError('block plan: unknown or duplicate source block')
            seen.add(intent['block'])
            old = by_id[intent['block']]
            target, section = intent.get('to'), intent.get('section')
            if target not in destinations or not isinstance(section, str):
                raise ValueError('block plan: destination must be an indexed wiki topic/archive')
            raw = old['text']
            if operation == 'updates':
                if kind == 'restructure':
                    raise ValueError('block plan: a pure split cannot update facts')
                evidence = intent.get('source', {})
                line, quote = evidence.get('line'), evidence.get('quote')
                if (not isinstance(line, int) or isinstance(line, bool) or not 1 <= line <= len(source)
                        or not isinstance(quote, str) or not quote.strip() or source[line - 1] != quote
                        or not isinstance(intent.get('reason'), str) or not intent['reason'].strip()):
                    raise ValueError('block plan: update needs exact frozen transcript line and supersession reason')
                raw = intent.get('text', '')
                replacement = blocks(target, raw) if isinstance(raw, str) else []
                if len(replacement) != 1 or replacement[0]['text'] != raw:
                    raise ValueError('block plan: replacement must be exactly one body block')
            origin, destination = location(old), (target, section, raw)
            expected[origin] -= 1
            expected[destination] += 1
            affected.update((origin, destination))
    # Render counts together so identical source blocks retain their multiplicity.
    # Re-rendering the final tree is idempotent, including same-page section moves.
    for path, section, raw in sorted(affected):
        matches = [row for row in blocks(path, result.get(path, ''))
                   if row['text'] == raw and row['section'] == section]
        desired = expected[(path, section, raw)]
        for row in reversed(matches[desired:]):
            result[path] = remove_block(result[path], row)
        for _ in range(max(0, desired - len(matches))):
            result[path] = append_block(result[path], section, raw)
    return result


def scripted_moves(repo, coverage, files):
    """Record exact relocations made by program callbacks, never model edits.

    Match full raw blocks and occurrence counts. Changed or missing text has no
    matching destination and still fails the ordinary coverage check.
    """
    by_id, snapshots = inventory(repo, coverage['sources'])
    location = lambda row: (row['path'], row['section'], row['text'])
    before = Counter()
    for snapshot in snapshots:
        before |= Counter(location(row) for row in snapshot)
    after = Counter(location(row) for path, text in pages(files, indexed=True).items() for row in blocks(path, text))
    missing, extra = before - after, after - before
    moves = []
    for row in by_id.values():
        origin = location(row)
        if not missing[origin]:
            continue
        destination = next((loc for loc in sorted(extra) if extra[loc] and loc[2] == row['text']), None)
        if destination:
            moves.append(dict(block=row['id'], to=destination[0], section=destination[1]))
            missing[origin] -= 1
            extra[destination] -= 1
    return dict(moves=moves, updates=[])


def review_key(coverage, files, kind):
    return digest(dict(sources=coverage['sources'], input=coverage['input'],
                       plan=coverage['plan'], final=files, kind=kind))


def review_path(repo, key):
    return repo / '.ingest-archives' / 'block-reviews' / (key + '.json')


def reviewed(repo, coverage, files, kind):
    # Source: legacy contracts required a receipt; delivered commits keep their recorded policy.
    if not coverage['plan']['updates'] or not coverage.get('review_required', True):
        return True
    key = review_key(coverage, files, kind)
    path = review_path(repo, key)
    if not path.is_file():
        return False
    receipt = json.loads(path.read_text(encoding='utf-8'))
    return receipt.get('subject') == key and bool(receipt.get('reviewer')) and bool(receipt.get('reason'))


def materialize(repo, root, coverage, kind):
    files = working_tree(root)
    final = render(repo, coverage, files, kind)
    if not reviewed(repo, coverage, final, kind):
        return 'block review required: exact source is valid; supersession needs independent content review'
    for path, text in final.items():
        if files.get(path) != text:
            (root / path).write_text(text, encoding='utf-8')
    return ''


def check(repo, coverage, files, kind='ingest'):
    """Prove exact body coverage and declared relocation, not natural-language truth."""
    by_id, snapshots = inventory(repo, coverage['sources'])
    final = pages(files, indexed=True)
    rows = [row for path, text in final.items() for row in blocks(path, text)]
    counts = Counter(row['text'] for row in rows)
    updates = {intent['block']: intent for intent in coverage['plan']['updates']}
    # Old pending sources keep immutable provenance, but an accepted intervening
    # delivery may already have relocated them. Follow its declared operations,
    # rather than requiring every historical source path to exist again.
    relocated = {}
    # Source sections may differ across frozen versions of the same page.
    # Like at_source below, identify the unchanged source by path + exact bytes;
    # the declared destination still includes its section and counts stay exact.
    for intent in coverage['plan']['moves']:
        row = by_id[intent['block']]
        relocated.setdefault((row['path'], row['text']), set()).add(
            (intent['to'], intent['section'], row['text']))
    if len(coverage['sources']) > 1:
        commits = git(repo, 'rev-list', '--reverse', '--ancestry-path',
                      coverage['sources'][0] + '..' + coverage['sources'][-1]).decode().splitlines()
        for commit in commits:
            delivered = from_message(git(repo, 'show', '-s', '--format=%B', commit).decode())
            if not delivered or not delivered['plan']['moves']:
                continue
            original, _ = inventory(repo, delivered['sources'])
            for intent in delivered['plan']['moves']:
                row = original[intent['block']]
                origin = (row['path'], row['text'])
                destination = (intent['to'], intent['section'], row['text'])
                relocated.setdefault(origin, set()).add(destination)
    errors, required = [], Counter()
    # Direct acceptance/deliver/recovery may not bypass the program-owned writer.
    if render(repo, coverage, files, kind) != files:
        errors.append('block coverage: declared operations have not been materialized')
    if not reviewed(repo, coverage, files, kind):
        errors.append('block review required: supersession has no receipt for this exact final tree')
    for snapshot in snapshots:
        expected = Counter(row['text'] for row in snapshot if row['id'] not in updates)
        required |= expected
        for old in snapshot:
            if old['id'] in updates:
                continue
            locations = {(old['path'], old['section'], old['text'])}
            todo = list(locations)
            for origin in todo:
                for destination in relocated.get((origin[0], origin[2]), ()):
                    if destination not in locations:
                        locations.add(destination)
                        todo.append(destination)
            at_source = any(row['text'] == old['text'] and row['path'] == old['path'] for row in rows) or any(
                (row['path'], row['section'], row['text']) in locations for row in rows)
            if not at_source:
                errors.append(f"block coverage: {old['path']}:{old['line']} ({old['id']}) has no declared searchable destination")
    for text, count in (required - counts).items():
        errors.append(f'block coverage: {count} original block occurrence(s) missing: {text}')
    for intent in updates.values():
        if not any(row['path'] == intent['to'] and row['section'] == intent['section']
                   and row['text'] == intent['text'] for row in rows):
            errors.append('block coverage: reviewed replacement is absent')
        old = by_id[intent['block']]
        if any(row['path'] == old['path'] and row['section'] == old['section']
               and row['text'] == old['text'] for row in rows):
            errors.append('block coverage: superseded block is still presented as current at its source')
    if kind == 'restructure' and counts != required:
        errors.append('block coverage: pure split body multiset differs from its frozen sources')
    return errors


def from_message(message):
    lines = [line for line in message.splitlines() if line.startswith(TRAILER)]
    if len(lines) > 1:
        raise ValueError('block coverage: duplicate coverage trailers')
    return json.loads(lines[0][len(TRAILER):]) if lines else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['show', 'approve'])
    parser.add_argument('--repo', type=Path, required=True)
    subject = parser.add_mutually_exclusive_group(required=True)
    subject.add_argument('--session')
    subject.add_argument('--candidate', help='saved maintenance review commit')
    parser.add_argument('--reviewer')
    parser.add_argument('--reason')
    args = parser.parse_args()
    import os
    if os.environ.get('WIKI_INGEST'):
        parser.error('a model ingest process cannot approve its own candidate')
    ref = 'refs/wiki-ingest/pending/' + args.session if args.session else args.candidate
    sha = revision(args.repo, ref)
    message = git(args.repo, 'show', '-s', '--format=%B', sha).decode()
    pending = next((json.loads(line.partition(': ')[2]) for line in message.splitlines()
                    if line.startswith('Wiki-Ingest-Pending: ')), None)
    coverage = pending['coverage'] if pending else from_message(message)
    if coverage is None:
        parser.error('candidate has no frozen block coverage')
    kind = coverage.get('kind', 'ingest')
    final = render(args.repo, coverage, tree(args.repo, sha), kind)
    key = review_key(coverage, final, kind)
    if args.action == 'show':
        by_id, _ = inventory(args.repo, coverage['sources'])
        print(canonical(dict(subject=key, candidate=sha, sources=coverage['sources'],
                             transcript=git(args.repo, 'cat-file', 'blob', coverage['input']).decode(),
                             updates=[dict(before=by_id[i['block']], intent=i) for i in coverage['plan']['updates']],
                             proposed_final=final)))
        return
    held = pending and pending['stage'] == 'review'
    if not pending:
        held = git(args.repo, 'rev-parse', '--verify', 'refs/wiki-ingest/reviews/' + sha).decode().strip() == sha
    if not held or not args.reviewer or not args.reason:
        parser.error('approval requires review-stage pending candidate, reviewer and content-review reason')
    path = review_path(args.repo, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    receipt = dict(subject=key, candidate=sha, reviewer=args.reviewer, reason=args.reason)
    with path.open('x', encoding='utf-8') as stream:
        stream.write(canonical(receipt) + '\n')
    print('Content review recorded; candidate remains pending until ordinary acceptance and delivery: ' + key)


if __name__ == '__main__':
    main()
