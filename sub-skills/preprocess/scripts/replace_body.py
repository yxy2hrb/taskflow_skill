#!/usr/bin/env python3
import argparse
import re
import sys
from pathlib import Path

BODY_RE = re.compile(r"<body\b[^>]*>.*?</body>", re.IGNORECASE | re.DOTALL)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")


def extract_body(body_text: str) -> str:
    m = BODY_RE.search(body_text)
    if not m:
        raise ValueError("body_source 中未找到完整 <body>...</body> 区块")
    return m.group(0)


def replace_body(target_html: str, new_body_block: str) -> tuple[str, int, int]:
    matches = list(BODY_RE.finditer(target_html))
    if len(matches) != 1:
        raise ValueError(f"目标HTML中 body 区块数量异常: {len(matches)}，要求必须唯一")

    old_body = matches[0].group(0)
    replaced = target_html[:matches[0].start()] + new_body_block + target_html[matches[0].end():]
    return replaced, len(old_body), len(new_body_block)


def main() -> int:
    parser = argparse.ArgumentParser(description="Replace <body>...</body> block in HTML safely.")
    parser.add_argument("--target", required=True, help="Path to target HTML file")
    parser.add_argument("--body", required=True, help="Path to file containing full <body>...</body>")
    parser.add_argument("--out", required=False, help="Output HTML path; defaults to overwrite target")
    args = parser.parse_args()

    target_path = Path(args.target)
    body_path = Path(args.body)
    out_path = Path(args.out) if args.out else target_path

    if not target_path.exists():
        print(f"[ERROR] target file not found: {target_path}", file=sys.stderr)
        return 2
    if not body_path.exists():
        print(f"[ERROR] body file not found: {body_path}", file=sys.stderr)
        return 2

    try:
        target_html = read_text(target_path)
        body_text = read_text(body_path)
        new_body = extract_body(body_text)
        updated_html, old_len, new_len = replace_body(target_html, new_body)
        write_text(out_path, updated_html)
    except Exception as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 1

    print(f"[OK] replaced body in: {target_path}")
    print(f"[OK] output file: {out_path}")
    print(f"[OK] old_body_len={old_len}, new_body_len={new_len}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
