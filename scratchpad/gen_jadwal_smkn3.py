SEP=chr(44)+chr(10)
# -*- coding: utf-8 -*-
import json,collections,sys
SP=sys.argv[1]
d=json.load(open(SP+'/parsed.json',encoding='utf-8'))
lk=json.load(open(SP+'/lookup.json',encoding='utf-8'))
SCHOOL='561cc906-e6e0-40c7-a5b0-d8f69a15258a'; AY='2026/2027'; SEM='1'
CLSMAP={'X ATP':'X ATP','X APAT':'X APAT','X 0TKP':'X OTKP','X TB':'X DPB','X DPB':'X DPB',
 'XI ATP':'XI ATP','XI APAT':'XI APAT','XI OTKP':'XI OTKP','XI OTK':'XI OTKP','XI OTK P':'XI OTKP',
 '':'XI OTKP','XI TB':'XI DPB','XI DPB':'XI DPB','XII ATP':'XII ATP','XII OTKP':'XII OTKP'}
cid={c['name']:c['class_id'] for c in lk['classes']}
tid={t['teacher_code']:t['user_id'] for t in lk['teachers']}
DAYS=['SENIN','SELASA','RABU','KAMIS','JUMAT']

# --- time slots per hari (gabungan break + mengajar, urut waktu) ---
per={d0:{} for d0 in DAYS}
for x in d['items']:
    k=(x['start'],x['end'])
    cur=per[x['day']].get(k)
    isb = x['kind']=='break'
    if cur is None: per[x['day']][k]=(isb, x.get('label'))
    elif cur[0] and not isb: per[x['day']][k]=(False,None)
slot_rows=[]
for day in DAYS:
    for i,(k,v) in enumerate(sorted(per[day].items()),1):
        slot_rows.append((day,i,k[0],k[1],v[0],v[1]))

# --- templates ---
tpl=[]; skipped=collections.Counter()
for x in d['items']:
    if x['kind']!='slot': continue
    cn=CLSMAP.get(x['cls']); c=cid.get(cn); t=tid.get(x['code'])
    if not c: skipped['kelas:'+repr(x['cls'])]+=1; continue
    if not t: skipped['guru:'+x['code']]+=1; continue
    tpl.append((x['day'],x['start'],x['end'],c,t,x['subject'][:50]))
seen=set(); ded=[]
for r in tpl:
    k=(r[0],r[1],r[3],r[4])
    if k in seen: skipped['duplikat-uq']+=1; continue
    seen.add(k); ded.append(r)

L=[]
L.append("-- Import jadwal SMK Negeri 3 Rambah (slug smkn3)")
L.append("-- school_id: %s | academic_year: %s | semester: %s"%(SCHOOL,AY,SEM))
L.append("-- Sumber: JADWAL PELAJARAN SEMESTER GANJIL 2025 - 2026 GENAP.xlsx")
L.append("-- Idempotent: DELETE tenant-scoped lalu INSERT.\n")
L.append("BEGIN;\n")
L.append("DELETE FROM schedule_time_slots WHERE school_id='%s' AND academic_year='%s' AND semester='%s';"%(SCHOOL,AY,SEM))
L.append("DELETE FROM schedule_templates  WHERE school_id='%s' AND academic_year='%s' AND semester='%s';\n"%(SCHOOL,AY,SEM))
L.append("INSERT INTO schedule_time_slots (school_id,academic_year,semester,day_of_week,slot_number,start_time,end_time,is_break,break_label) VALUES")
vs=["('%s','%s','%s','%s',%d,'%s','%s',%s,%s)"%(SCHOOL,AY,SEM,r[0],r[1],r[2],r[3],
     'TRUE' if r[4] else 'FALSE', ("'"+r[5].replace("'","''")+"'") if r[4] else 'NULL') for r in slot_rows]
L.append(',\n'.join(vs)+';\n')
L.append("INSERT INTO schedule_templates (school_id,academic_year,semester,day_of_week,start_time,end_time,class_id,teacher_id,subject_label) VALUES")
vt=["('%s','%s','%s','%s','%s','%s','%s','%s','%s')"%(SCHOOL,AY,SEM,r[0],r[1],r[2],r[3],r[4],r[5].replace("'","''")) for r in ded]
L.append(SEP.join(vt)+chr(59))
L.append("COMMIT;")
open(SP+'/import_smkn3.sql','w',encoding='utf-8').write('\n'.join(L))
print('time_slots rows:',len(slot_rows))
print('template rows  :',len(ded))
print('SKIPPED:'); 
for k,v in skipped.most_common(): print('  ',k,v)
