#!/usr/bin/env python3
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DICT_DIR = ROOT / "data" / "DICT"
DICT_JSON = ROOT / "data" / "dictionary.json"


HEADWORD_RE = re.compile(r"^[A-Za-z][A-Za-z ,()'./-]*$")
CHINESE_SEGMENT_RE = re.compile(r"[\u4e00-\u9fff（）()、；，,·…\s]{2,}")


def load_dictionary_entries():
    data = json.loads(DICT_JSON.read_text())
    if isinstance(data, list):
        return data, data, True
    return data, data.get("words", []), False


def normalize_term(term: str) -> str:
    return re.sub(r"\s+", " ", term.strip().lower())


def split_variants(headword: str):
    # "co-op, co op" -> ["co-op", "co op"]
    # "op (also Op)" -> ["op"]
    cleaned = re.sub(r"\([^)]*\)", "", headword).strip()
    variants = []
    for piece in cleaned.split(","):
        piece = normalize_term(piece)
        if piece:
            variants.append(piece)
    return variants


def is_headword(lines, idx):
    if idx + 1 >= len(lines):
        return False
    line = lines[idx].strip()
    next_line = lines[idx + 1].strip()
    if not line or not next_line.startswith("/"):
        return False
    if not HEADWORD_RE.match(line):
        return False
    return True


def iter_entries(text: str):
    lines = text.splitlines()
    starts = [i for i in range(len(lines)) if is_headword(lines, i)]
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(lines)
        headword = lines[start].strip()
        first_line = lines[start + 1].strip()
        m = re.match(r"^(\/[^\/]+\/)\s*(.*)$", first_line)
        if m:
            phonetic_line = m.group(1).strip()
            rest = m.group(2).strip()
        else:
            phonetic_line = first_line
            rest = ""
        body_lines = []
        if rest:
            body_lines.append(rest)
        body_lines.extend(lines[start + 2 : end])
        body = "\n".join(body_lines).strip()
        yield headword, phonetic_line, body


def extract_translation(body: str):
    candidates = []
    for raw in CHINESE_SEGMENT_RE.findall(body):
        text = re.sub(r"\s+", " ", raw).strip(" ：:;；,.。* ")
        if len(text) < 2:
            continue
        if text in {"通常作定语", "语言", "口", "文", "作定语", "文体"}:
            continue
        if any(ch.isascii() and ch.isalpha() for ch in text):
            continue
        candidates.append(text)

    normalized = []
    seen = set()
    for c in candidates:
        c = c.replace(",", "；").replace("，", "；")
        c = re.sub(r"\s+", "", c)
        c = c.strip("；")
        if not c or c in seen:
            continue
        seen.add(c)
        normalized.append(c)
        if len(normalized) >= 3:
            break
    return "；".join(normalized)


def extract_expansions(body: str):
    examples = []
    for line in body.splitlines():
        if ":" not in line:
            continue
        after = line.split(":", 1)[1].strip()
        if after:
            examples.extend([part.strip() for part in after.split("*") if part.strip()])
    cleaned = []
    for ex in examples:
        ex = re.sub(r"\s+", " ", ex)
        if len(ex) < 6:
            continue
        cleaned.append(ex)
        if len(cleaned) >= 4:
            break
    return cleaned


def build_index():
    index = {}
    for path in sorted(DICT_DIR.rglob("*.txt")):
        text = path.read_bytes().decode("gb18030", errors="ignore")
        for headword, phonetic_line, body in iter_entries(text):
            entry = {
                "headword": headword,
                "phonetic": phonetic_line,
                "body": body,
                "translation": extract_translation(body),
                "expansions": extract_expansions(body),
                "source_file": str(path.relative_to(ROOT)),
            }
            for variant in split_variants(headword):
                index.setdefault(variant, entry)
    return index


def main():
    data, items, is_list = load_dictionary_entries()
    index = build_index()

    matched = 0
    updated = 0
    samples = []
    for item in items:
        term = normalize_term(str(item.get("term", "")))
        if not term or term not in index:
            continue
        ref = index[term]
        matched += 1

        new_translation = ref["translation"] or str(item.get("translation", "")).strip()
        new_analysis = ref["body"] or str(item.get("analysis", "")).strip()
        new_phonetic = ref["phonetic"] or str(item.get("phonetic", "")).strip()
        new_expansions = ref["expansions"] or item.get("expansions", [])
        new_answers = [seg.strip() for seg in re.split(r"[；;]", new_translation) if seg.strip()]

        before = (
            item.get("translation"),
            item.get("analysis"),
            item.get("phonetic"),
            tuple(item.get("expansions", [])),
        )

        item["translation"] = new_translation
        item["analysis"] = new_analysis
        item["phonetic"] = new_phonetic
        item["pronunciation"] = new_phonetic
        if new_expansions:
            item["expansions"] = new_expansions
        if new_answers:
            item["accepted_answers"] = new_answers
        item.setdefault("dict_source", ref["source_file"])
        item["dict_source"] = ref["source_file"]

        after = (
            item.get("translation"),
            item.get("analysis"),
            item.get("phonetic"),
            tuple(item.get("expansions", [])),
        )
        if before != after:
            updated += 1
            if len(samples) < 8:
                samples.append({"term": term, "source": ref["source_file"]})

    if is_list:
        DICT_JSON.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n")
    else:
        data["words"] = items
        DICT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    print(
        json.dumps(
            {
                "dict_indexed": len(index),
                "matched_terms": matched,
                "updated_terms": updated,
                "samples": samples,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
