#!/usr/bin/env python3
import argparse
import json
import random
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


def save_dictionary_entries(data, items, is_list):
    if is_list:
        DICT_JSON.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n")
    else:
        data["words"] = items
        DICT_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def normalize_term(term: str):
    return re.sub(r"\s+", " ", term.strip().lower())


def split_variants(headword: str):
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
    return bool(HEADWORD_RE.match(line))


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
    seen = set()
    for ex in examples:
        ex = re.sub(r"\s+", " ", ex)
        if len(ex) < 6:
            continue
        if ex in seen:
            continue
        seen.add(ex)
        cleaned.append(ex)
        if len(cleaned) >= 5:
            break
    return cleaned


def normalize_legacy_phonetic(raw: str):
    text = (raw or "").strip()
    if not text:
        return ""
    inner = text.strip("/").strip()
    if not inner:
        return text

    variants = [part.strip() for part in inner.split(";") if part.strip()]
    normalized = []
    for var in variants:
        v = re.sub(r"^\?@\s*", "", var)
        v = v.replace(" ", "")
        replacements = [
            ("Rr", "ɔːr"),
            ("eI", "eɪ"),
            ("aI", "aɪ"),
            ("EU", "əʊ"),
            ("oU", "oʊ"),
            ("i:", "iː"),
            ("u:", "uː"),
            ("R:", "ɔː"),
            ("\\:", "ɜː"),
            ("[", "ɜː"),
            ("tF", "tʃ"),
            ("dV", "dʒ"),
            ("5", "ˈ"),
            ("`", "ˈ"),
            ("9", "ˌ"),
            ("A", "æ"),
            ("Z", "e"),
            ("N", "ŋ"),
            ("W", "θ"),
            ("^", "g"),
            ("L", "ə"),
            ("R", "ɔː"),
            ("C", "ɒ"),
            ("B", "ɑː"),
            ("Q", "ʌ"),
            ("E", "ə"),
            ("I", "ɪ"),
            ("F", "ʃ"),
            ("V", "ʒ"),
        ]
        for src, dst in replacements:
            v = v.replace(src, dst)
        normalized.append(v)
    return "/ " + "; ".join(normalized) + "/"


def detect_pos(body: str):
    first_line = body.splitlines()[0].strip() if body else ""
    lowered = first_line.lower()
    tags = []
    if re.search(r"\bn\b", lowered):
        tags.append("N")
    if re.search(r"\bv\b", lowered):
        tags.append("V")
    if re.search(r"\badj\b", lowered):
        tags.append("Adj")
    if re.search(r"\badv\b", lowered):
        tags.append("Adv")
    if not tags:
        return "word"
    return " / ".join(tags)


def build_index():
    index = {}
    for path in sorted(DICT_DIR.rglob("*")):
        if not path.is_file() or path.suffix.lower() != ".txt":
            continue
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


def to_dictionary_item(term: str, ref: dict):
    translation = ref["translation"] or term
    analysis = ref["body"] or translation
    phonetic = normalize_legacy_phonetic(ref["phonetic"])
    expansions = ref["expansions"] or [translation]
    accepted_answers = [seg.strip() for seg in re.split(r"[；;]", translation) if seg.strip()]
    return {
        "term": term,
        "type": "word" if " " not in term else "phrase",
        "pos": detect_pos(ref["body"]),
        "translation": translation,
        "analysis": analysis,
        "phonetic": phonetic or "待查",
        "origin": "待查",
        "expansions": expansions,
        "pronunciation": phonetic or "待查",
        "accepted_answers": accepted_answers or [term],
        "added_at": "",
        "review": {"correct_count": 0, "incorrect_count": 0, "review_history": []},
        "dict_source": ref["source_file"],
    }


def merge_items(old: dict, new: dict):
    merged = dict(old)
    for key, value in new.items():
        if key == "added_at":
            merged[key] = old.get(key) or value
        elif key == "review":
            merged[key] = old.get(key) or value
        else:
            merged[key] = value
    return merged


def backfill_existing(items, index):
    matched = 0
    updated = 0
    samples = []
    for item in items:
        term = normalize_term(str(item.get("term", "")))
        if not term or term not in index:
            continue
        ref = index[term]
        normalized = to_dictionary_item(term, ref)
        before = json.dumps(item, ensure_ascii=False, sort_keys=True)
        merged = merge_items(item, normalized)
        item.clear()
        item.update(merged)
        after = json.dumps(item, ensure_ascii=False, sort_keys=True)
        matched += 1
        if before != after:
            updated += 1
            if len(samples) < 8:
                samples.append({"term": term, "source": ref["source_file"]})
    return matched, updated, samples


def prioritized_terms(index, seed_term: str, limit: int, existing_terms=None):
    all_terms = sorted(index.keys())
    target_initial = seed_term[:1]
    existing_terms = existing_terms or set()

    def allowed(term: str):
        if term == seed_term:
            return True
        return term not in existing_terms

    same_initial = [t for t in all_terms if t.startswith(target_initial) and allowed(t)]
    other_initial = [t for t in all_terms if not t.startswith(target_initial) and allowed(t)]

    rnd = random.Random(seed_term)
    rnd.shuffle(same_initial)
    rnd.shuffle(other_initial)

    ordered = [seed_term] if seed_term in index else []
    ordered.extend(same_initial)
    ordered.extend(other_initial)
    return ordered[:limit]


def expand_neighbors(items, index, seed_term: str, limit: int):
    existing = {normalize_term(str(item.get("term", ""))): i for i, item in enumerate(items)}
    ordered_terms = prioritized_terms(index, seed_term, limit, set(existing))
    added = 0
    updated = 0
    samples = []

    for term in ordered_terms:
        ref = index.get(term)
        if not ref:
            continue
        new_item = to_dictionary_item(term, ref)
        if term in existing:
            idx = existing[term]
            before = json.dumps(items[idx], ensure_ascii=False, sort_keys=True)
            items[idx] = merge_items(items[idx], new_item)
            after = json.dumps(items[idx], ensure_ascii=False, sort_keys=True)
            if before != after:
                updated += 1
                if len(samples) < 8:
                    samples.append({"term": term, "action": "updated", "source": ref["source_file"]})
        else:
            items.append(new_item)
            existing[term] = len(items) - 1
            added += 1
            if len(samples) < 8:
                samples.append({"term": term, "action": "added", "source": ref["source_file"]})
    return added, updated, samples


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--term", help="Seed term for nearby dictionary expansion")
    parser.add_argument("--limit", type=int, default=500, help="Max nearby terms to process")
    args = parser.parse_args()

    data, items, is_list = load_dictionary_entries()
    index = build_index()

    result = {"dict_indexed": len(index)}

    if args.term:
        seed_term = normalize_term(args.term)
        added, updated, samples = expand_neighbors(items, index, seed_term, args.limit)
        save_dictionary_entries(data, items, is_list)
        result.update(
            {
                "seed_term": seed_term,
                "neighbor_target": args.limit,
                "neighbor_added": added,
                "neighbor_updated": updated,
                "dictionary_total": len(items),
                "samples": samples,
            }
        )
    else:
        matched, updated, samples = backfill_existing(items, index)
        save_dictionary_entries(data, items, is_list)
        result.update(
            {
                "matched_terms": matched,
                "updated_terms": updated,
                "samples": samples,
            }
        )

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
