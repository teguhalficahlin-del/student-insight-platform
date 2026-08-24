# -*- coding: utf-8 -*-
import openpyxl, json, re, sys
SRC=r'D:\ribuan_pengguna\CLAUDE\SMK 3 RBH\JADWAL PELAJARAN SEMESTER GANJIL 2025 - 2026 GENAP.xlsx'
wb=openpyxl.load_workbook(SRC,data_only=True); ws=wb['Sheet1']
rows=[[('' if v is None else str(v).strip()) for v in r] for r in ws.iter_rows(values_only=True)]

# blok hari: (header_row_idx0, day, data_row_range)
BLOCKS=[(0,'SENIN',range(1,14)),(14,'SELASA',range(15,28)),
        (28,'RABU',range(29,42)),(42,'KAMIS',range(43,56)),
        (56,'JUMAT',range(57,65))]

def norm_time(s):
    s=s.replace(' ','')
    m=re.match(r'^(\d{1,2})[.\-:](\d{2})[.\-–]+(\d{1,2})[.\-:]?(\d{2})$', s.replace('.-','.'))
    return m
def parse_range(s):
    s=s.strip().replace(' ','')
    s=s.replace('12.-30','12.30').replace('09-45','09.45').replace('08-00.08.30','08.00-08.30')
    parts=re.split(r'[-–]', s)
    parts=[p for p in parts if p]
    if len(parts)!=2: return None
    def t(p):
        p=p.replace(':','.').strip('.')
        m=re.match(r'^(\d{1,2})\.(\d{2})$',p)
        if not m: return None
        return '%02d:%s:00'%(int(m.group(1)),m.group(2))
    a,b=t(parts[0]),t(parts[1])
    if not a or not b or b<=a: return None
    return a,b

out=[]; problems=[]
for hidx,day,rng in BLOCKS:
    hdr=rows[hidx]
    # kolom kelas: mulai index 3, step 2 (kelas, guru)
    cols=[]
    c=3
    while c+1 < len(hdr):
        nm=hdr[c].strip()
        if hdr[c+1].strip().upper()=='GURU':
            cols.append((c,nm))
        c+=2
    for ri in rng:
        r=rows[ri]
        jam=r[1].strip(); waktu=r[2].strip()
        if not waktu: continue
        tr=parse_range(waktu)
        if not tr:
            problems.append((day,ri+1,'waktu tak terparse: %r'%waktu)); continue
        st,en=tr
        # deteksi baris kegiatan/istirahat: semua kolom kelas kosong ATAU kolom guru kosong semua
        vals=[(r[c].strip() if c<len(r) else '', r[c+1].strip() if c+1<len(r) else '') for c,_ in cols]
        subs=[v[0] for v in vals if v[0]]
        gurus=[v[1] for v in vals if v[1]]
        if not gurus:
            label = subs[0].upper() if subs else 'ISTIRAHAT'
            out.append(dict(kind='break',day=day,start=st,end=en,label=label,row=ri+1))
            continue
        for (c,cls),(sub,gu) in zip(cols,vals):
            if not sub and not gu: continue
            out.append(dict(kind='slot',day=day,start=st,end=en,cls=cls,
                            subject=re.sub(r'\s+',' ',sub).strip(),code=gu.strip().upper(),row=ri+1))
json.dump(dict(items=out,problems=problems),open(sys.argv[1],'w',encoding='utf-8'),ensure_ascii=False,indent=1)
print('slots:',sum(1 for x in out if x['kind']=='slot'),'breaks:',sum(1 for x in out if x['kind']=='break'))
print('problems:',problems)
print('kelas header unik:',sorted({x['cls'] for x in out if x['kind']=='slot'}))
print('kode guru unik:',sorted({x['code'] for x in out if x['kind']=='slot'}))
