"""아이콘 부분 글꼴 다시 만들기 (새 아이콘 이름을 코드에 추가했을 때 실행)

준비:  cd tools/fonts && npm install && pip install fonttools brotli
실행:  python3 build-icon-subset.py
결과:  public/fonts/material-symbols-rounded-subset.woff2, tools/fonts/icons-included.json 갱신

방식: 원본 Material Symbols Rounded(전체, 변수 글꼴)에서, 앱 코드(index.html·public·Apps Script)에 나오는 단어 중
      아이콘 이름과 일치하는 것을 모두 포함(넉넉하게)한 부분 글꼴을 만든다. FILL·wght·GRAD·opsz 축은 유지.
"""
import json, re, glob, os
from fontTools.ttLib import TTFont
from fontTools import subset
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(HERE, 'node_modules', 'material-symbols', 'material-symbols-rounded.woff2')
OUT = os.path.join(ROOT, 'public', 'fonts', 'material-symbols-rounded-subset.woff2')

def ligatures(font):
    rev = {g: chr(c) for c, g in font.getBestCmap().items()}; out = {}
    for lookup in font['GSUB'].table.LookupList.Lookup:
        for st in lookup.SubTable:
            if st.LookupType == 7: st = st.ExtSubTable
            if hasattr(st, 'ligatures'):
                for first, ligs in st.ligatures.items():
                    for lig in ligs:
                        try: out[''.join(rev[x] for x in [first] + list(lig.Component))] = lig.LigGlyph
                        except KeyError: pass
    return out

f = TTFont(SRC); names = ligatures(f)
files = [os.path.join(ROOT, 'index.html'), os.path.join(ROOT, 'gmail_sync_apps_script.js'), os.path.join(ROOT, 'public', 'styles', 'style.css')] + glob.glob(os.path.join(ROOT, 'public', '**', '*.js'), recursive=True)
tokens = set()
for p in files:
    with open(p, encoding='utf-8') as fh: tokens |= set(re.findall(r'[a-z0-9_]+', fh.read()))
used = sorted(t for t in tokens if t in names)
cmap = f.getBestCmap(); chars = set(''.join(used)) | set('abcdefghijklmnopqrstuvwxyz0123456789_ ')
glyphs = {names[n] for n in used} | {cmap[ord(c)] for c in chars if ord(c) in cmap} | {'.notdef'}
opts = subset.Options(); opts.layout_closure = False; opts.layout_features = ['*']; opts.flavor = 'woff2'; opts.notdef_outline = True; opts.name_IDs = ['*']; opts.name_languages = ['*']
s = subset.Subsetter(options=opts); s.populate(glyphs=sorted(glyphs), unicodes=[ord(c) for c in chars]); s.subset(f)
subset.save_font(f, OUT, opts)
included = sorted(ligatures(TTFont(OUT)).keys())
json.dump(included, open(os.path.join(HERE, 'icons-included.json'), 'w'), ensure_ascii=False, indent=0)
print(f'아이콘 {len(used)}개 포함, {os.path.getsize(OUT)/1024:.0f}KB → {OUT}')
