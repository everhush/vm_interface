"""Exact OCR boot marker on original, and scaled/inverted source pixels."""
import re
import subprocess

MARKER = "VMINTERFACEISOBOOTOK"

def parse_pgm(raw):
    magic, dims, max_value, pixels = raw.split(b"\n", 3)
    w,h = map(int,dims.split())
    if magic != b"P5" or max_value != b"255" or not 0<w<=1920 or not 0<h<=1200 or len(pixels)!=w*h:
        raise ValueError("Invalid or oversized guest raster")
    return w,h,pixels

def crop_for_ocr(w,h,pixels):
    # Real BIOS screenshot in artifact 15100947613 is white text on black.
    # Preserve exact pixels, invert, crop only background, enlarge 5x, pad white.
    dark = sum(pixels) < len(pixels)*128
    fg = (lambda value: value>30) if dark else (lambda value: value<225)
    x0,y0,x1,y1 = w,h,0,0
    for y in range(h):
        for x,value in enumerate(pixels[y*w:(y+1)*w]):
            if fg(value):
                x0=min(x0,x); x1=max(x1,x+1); y0=min(y0,y); y1=max(y1,y+1)
    if x0>=x1 or y0>=y1:
        return None
    factor=5
    width=(x1-x0)*factor+40
    height=(y1-y0)*factor+40
    white=b"\xff"*20
    expanded=[bytes([255-v if dark else v])*factor for v in range(256)]
    data=bytearray(b"\xff"*(width*20))
    for y in range(y0,y1):
        row=white+b"".join(expanded[v] for v in pixels[y*w+x0:y*w+x1])+white
        data.extend(row*factor)
    data.extend(b"\xff"*(width*20))
    return f"P5\n{width} {height}\n255\n".encode()+data

def exact_marker(text):
    return MARKER in re.sub("[^A-Z]","",text.upper())

def read_marker(png):
    original=subprocess.run(["tesseract",str(png),"stdout","--psm","6"],capture_output=True,text=True,check=True,timeout=15).stdout
    if exact_marker(original):return True,original
    pgm=subprocess.check_output(["ffmpeg","-v","error","-i",str(png),"-frames:v","1","-f","image2pipe","-vcodec","pgm","-"],timeout=15)
    scaled=crop_for_ocr(*parse_pgm(pgm))
    if scaled:
        for psm in ("6","11"):
            text=subprocess.run(["tesseract","stdin","stdout","--psm",psm,"--dpi","180"],input=scaled,capture_output=True,check=True,timeout=15).stdout.decode()
            if exact_marker(text):return True,text
            original=text
    return False,original
