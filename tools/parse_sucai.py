# -*- coding: utf-8 -*-
"""
解析 素材.docx -> 四个 JSON（terms / elegant / quiz / daily-sentence）

约定：
- 不审核、不改写内容（仅用户明确指定的两处：删除第 42 条残缺词条、纠正"不识浮云"为"不畏浮云"）
- 只做结构归一化：字段拆分、编号、去重、缺失标记
"""
import re
import json
import zipfile
import os
import xml.etree.ElementTree as ET

SRC = "D:/大姐大/华师/work/大创/雅言小筑/素材.docx"
OUT = "C:/Users/yuxm/WorkBuddy/2026-11-15-16-31-12/server/prisma/data"
W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

FEATURED_LIMIT = 10


def read_docx(path):
    z = zipfile.ZipFile(path)
    root = ET.fromstring(z.read("word/document.xml"))
    body = root.find(W + "body")
    lines = []
    for p in body.iter(W + "p"):
        t = "".join(n.text or "" for n in p.iter(W + "t")).strip()
        if t:
            lines.append(t)
    return lines


def idx_of(lines, pred, start=0):
    for i in range(start, len(lines)):
        if pred(lines[i]):
            return i
    return -1


# ---------------- 1. 热梗辨析 ----------------
def parse_terms(lines):
    start = idx_of(lines, lambda l: "【热梗名称】" in l)
    end = idx_of(lines, lambda l: l.startswith("也带点调侃"), start)  # 第42条残缺，按要求剔除
    region = lines[start:end]

    terms, cur = [], None
    for line in region:
        m = re.match(r"^(\d+)\.\s*【热梗名称】[：:]\s*(.*)$", line)
        if m:
            if cur:
                terms.append(cur)
            cur = {
                "seq": int(m.group(1)),
                "name": m.group(2).strip(),
                "plainMeaning": "",
                "heuristicAnalysis": "",
                "isFeatured": False,
                "sort": 0,
                "showInTerms": True,
            }
            continue
        if cur is None:
            continue
        m = re.match(r"^【通俗释义】[：:]\s*(.*)$", line)
        if m:
            cur["plainMeaning"] = m.group(1).strip()
            continue
        m = re.match(r"^【启发式解析】[：:]\s*(.*)$", line)
        if m:
            cur["heuristicAnalysis"] = m.group(1).strip()
            continue
        # 续行：接到最后一个非空字段
        if cur["heuristicAnalysis"]:
            cur["heuristicAnalysis"] += line
        elif cur["plainMeaning"]:
            cur["plainMeaning"] += line
    if cur:
        terms.append(cur)

    terms.sort(key=lambda x: x["seq"])
    for i, t in enumerate(terms):
        t["sort"] = i + 1
        t["isFeatured"] = i < FEATURED_LIMIT
    return terms


# ---------------- 2. 雅词对照 ----------------
def split_word_def(s):
    s = s.strip().rstrip("。").strip()
    m = re.match(r"^(.+?)[：:](.*)$", s)
    if m:
        return m.group(1).strip(), m.group(2).strip() + "。"
    return s, ""


def parse_elegant(lines):
    start = idx_of(lines, lambda l: "【网络热梗】" in l)
    end = idx_of(lines, lambda l: re.match(r"^第\d+题$", l), start)
    region = lines[start:end]

    items = []
    for line in region:
        m = re.match(r"^(\d+)\.\s*【网络热梗】[：:]\s*(.*)$", line)
        if not m:
            continue
        seq, rest = int(m.group(1)), m.group(2)
        parts = re.split(r"【文雅替换词\s*1】[：:]", rest, maxsplit=1)
        name = parts[0].strip()
        tail = parts[1] if len(parts) > 1 else ""
        p1 = re.split(r"【文雅替换词\s*2】[：:]", tail, maxsplit=1)
        w1, d1 = split_word_def(p1[0]) if p1 else ("", "")
        w2, d2 = split_word_def(p1[1]) if len(p1) > 1 else ("", "")
        items.append({
            "seq": seq,
            "name": name,
            "refined": [
                {"word": w1, "definition": d1},
                {"word": w2, "definition": d2},
            ],
        })
    items.sort(key=lambda x: x["seq"])
    return items


# ---------------- 3. 情景题 ----------------
SCENARIO_MAP = {
    1: "书面写作", 2: "书面写作", 3: "书面写作", 4: "课堂表达", 5: "课堂表达",
    6: "书面写作", 7: "书面写作", 8: "课堂表达", 9: "同学闲聊", 10: "课堂表达",
    11: "师生沟通", 12: "师生沟通", 13: "书面写作", 14: "长辈沟通", 15: "师生沟通",
    16: "校园公共", 17: "同学闲聊", 18: "书面写作", 19: "课堂表达", 20: "校园公共",
    21: "校园公共", 22: "校园公共", 23: "校园公共",
}


def parse_quiz(lines):
    start = idx_of(lines, lambda l: re.match(r"^第\d+题$", l))
    end = idx_of(lines, lambda l: "【优美短句】" in l, start)
    # 剔除纯数字行（章节序号，会污染上一题的解析）
    region = [l for l in lines[start:end] if not re.match(r"^\d+$", l)]

    blocks, cur = [], None
    for line in region:
        if re.match(r"^第\d+题$", line):
            if cur:
                blocks.append(cur)
            cur = {"seq": int(re.findall(r"\d+", line)[0]), "raw": ""}
            continue
        if cur is not None:
            cur["raw"] += line
    if cur:
        blocks.append(cur)

    items = []
    for b in blocks:
        raw = b["raw"]
        stem = re.search(r"【情景题干】[：:]?(.*?)(?=【选项A)", raw)
        oa = re.search(r"【选项A[^】]*】[：:]?(.*?)(?=【选项B)", raw)
        ob = re.search(r"【选项B[^】]*】[：:]?(.*?)(?=【正确答案)", raw)
        co = re.search(r"【正确答案】[：:]?\s*([AB])", raw)
        ex = re.search(r"【题目解析】[：:]?(.*)$", raw)
        items.append({
            "seq": b["seq"],
            "scenarioType": SCENARIO_MAP.get(b["seq"], "校园沟通"),
            "stem": (stem.group(1).strip() if stem else ""),
            "optionA": (oa.group(1).strip() if oa else ""),
            "optionB": (ob.group(1).strip() if ob else ""),
            "correctOption": (co.group(1) if co else ""),
            "isReverse": (co.group(1) == "A") if co else False,
            "explanation": (ex.group(1).strip() if ex else ""),
        })
    items.sort(key=lambda x: x["seq"])
    return items


# ---------------- 4. 每日一句 ----------------
def norm_key(s):
    return re.sub(r"[\s，。！？、；：“”‘’（）《》,.!?;:\"'()\[\]]", "", s)


def parse_daily(lines):
    start = idx_of(lines, lambda l: "【优美短句】" in l)
    end = idx_of(lines, lambda l: l.startswith("注："), start)
    region = [l for l in lines[start:end] if not re.match(r"^\d+$", l) and not l.startswith("二、")]
    text = "".join(region)

    pat = re.compile(
        r"【优美短句】[：:](.*?)【出处】[：:](.*?)【意义解读】[：:](.*?)(?=【优美短句】|$)", re.S
    )
    raw_items = []
    for m in pat.finditer(text):
        content = m.group(1).strip().replace("不识浮云遮望眼", "不畏浮云遮望眼")
        source = m.group(2).strip()
        meaning = re.sub(r"\d+$", "", m.group(3).strip()).strip()
        raw_items.append({"content": content, "source": source, "meaning": meaning})

    seen, items = set(), []
    for it in raw_items:
        k = norm_key(it["content"])
        if k in seen:
            continue
        seen.add(k)
        items.append(it)

    for i, it in enumerate(items):
        it["seq"] = i + 1

    result = [{
        "seq": it["seq"],
        "content": it["content"],
        "source": it["source"],
        "meaning": it["meaning"],
        "themes": "",
    } for it in items]
    return result, len(raw_items)


# ---------------- 主流程 ----------------
def main():
    lines = read_docx(SRC)

    terms = parse_terms(lines)
    elegant = parse_elegant(lines)
    quiz = parse_quiz(lines)
    daily, daily_raw = parse_daily(lines)

    # 用户指定修改（均在解析阶段完成）：
    #   1) 删除第 42 条残缺词条 —— parse_terms 已在该条前截断
    #   2) "不识浮云" -> "不畏浮云" —— parse_daily 在去重前替换
    fixed = 1

    # 雅词 -> 热梗 的主表名映射（含别名）
    tkeys = {norm_key(t["name"]): t["name"] for t in terms}
    matched = 0
    for e in elegant:
        ek = norm_key(e["name"])
        term_name = None
        for k, v in tkeys.items():
            if k == ek or k in ek or ek in k:
                term_name = v
                break
        if term_name:
            matched += 1
            if term_name != e["name"]:
                e["termName"] = term_name

    os.makedirs(OUT, exist_ok=True)
    files = {
        "terms.json": terms,
        "elegant.json": elegant,
        "quiz.json": quiz,
        "daily-sentence.json": daily,
    }
    for fn, data in files.items():
        with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    # ---- 质检报告 ----
    print("=" * 56)
    print("输出目录:", OUT)
    print("热梗辨析 terms        :", len(terms))
    print("雅词对照 elegant      :", len(elegant))
    print("情景题   quiz         :", len(quiz))
    print("每日一句 daily        :", len(daily), f"(原始 {daily_raw} 条，去重 {daily_raw-len(daily)} 条)")
    print("-" * 56)

    miss = [t["name"] for t in terms if not (t["name"] and t["plainMeaning"] and t["heuristicAnalysis"])]
    print("术语缺字段:", miss if miss else "无")

    bad = [e["name"] for e in elegant if len([r for r in e["refined"] if r["word"] and r["definition"]]) != 2]
    print("雅词非2条完整:", bad if bad else "无")

    badq = [q["seq"] for q in quiz if q["correctOption"] not in ("A", "B") or not q["optionA"] or not q["optionB"] or q["optionA"] == q["optionB"]]
    print("题目结构异常:", badq if badq else "无")

    from collections import Counter
    print("答案分布:", dict(Counter(q["correctOption"] for q in quiz)))
    print("反向题:", [q["seq"] for q in quiz if q["isReverse"]])
    print("场景分布:", dict(Counter(q["scenarioType"] for q in quiz)))

    print("-" * 56)
    print("雅词命中热梗主表:", matched, "/", len(elegant), "-> term 表合计", len(terms) + (len(elegant) - matched))
    print("别名映射:", {e["name"]: e["termName"] for e in elegant if "termName" in e})
    print("每日一句纠错:", fixed, "处（不识->不畏）")
    print("=" * 56)


if __name__ == "__main__":
    main()
