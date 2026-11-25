"""Find a unique exact visible OCR label in real screenshot coordinates."""
import csv, io, re, struct, subprocess
def norm(value):
    return re.sub(r"[^a-z0-9]","",value.lower())
def parse_target(tsv, label, width, height):
    expected=norm(label)
    if not expected or not 1<=width<=1920 or not 1<=height<=1200:
        raise ValueError("Unsupported label or screenshot dimensions")
    groups={}
    for row in csv.DictReader(io.StringIO(tsv),delimiter="\t"):
        if row["level"]!="5" or not row["text"].strip():continue
        key=tuple(row[k] for k in ("page_num","block_num","par_num","line_num"))
        groups.setdefault(key,[]).append(row)
    matches=[]
    for line in groups.values():
        if norm(" ".join(r["text"] for r in line))!=expected:continue
        if any(float(r["conf"])<55 for r in line):continue
        left=min(int(r["left"]) for r in line);top=min(int(r["top"]) for r in line)
        right=max(int(r["left"])+int(r["width"]) for r in line);bottom=max(int(r["top"])+int(r["height"]) for r in line)
        if not 0<=left<right<=width or not 0<=top<bottom<=height:
            raise ValueError("OCR target outside display")
        matches.append(((left+right)//2,(top+bottom)//2))
    return matches[0] if len(matches)==1 else None
def locate_label(path,label):
    with path.open("rb") as f: head=f.read(24)
    if len(head)!=24 or head[:8]!=b"\x89PNG\r\n\x1a\n" or head[12:16]!=b"IHDR":raise ValueError("Invalid screenshot")
    width,height=struct.unpack(">II",head[16:24])
    tsv=subprocess.check_output(["tesseract",str(path),"stdout","--psm","11","tsv"],stderr=subprocess.DEVNULL,text=True,timeout=15)
    return parse_target(tsv,label,width,height)
