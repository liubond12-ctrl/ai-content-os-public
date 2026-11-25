"""Conservative local index; original assets are read-only."""
import hashlib, json, pathlib, re, zipfile
import xml.etree.ElementTree as ET
from pypdf import PdfReader
root = pathlib.Path(__file__).resolve().parents[1]
source = root / 'resources/source-pack/content-production-system'
def owners(text):
    return {k for k, names in [('demoa', ('示例甲','demoa')), ('demob', ('示例乙','demob'))] if any(n in text.lower() for n in names)}
def markdown_sections(text):
    stack, lines, start, label, result = [], [], 1, None, []
    def flush(end):
        if lines: result.append((' / '.join(h for _,h in stack), f'lines {start}-{end}', '\n'.join(lines), label))
    for n,line in enumerate(text.splitlines(),1):
        h = re.match(r'^(#{1,6})\s+(.+)',line)
        a = re.match(r'^\s*(?:[-*]\s*)?(示例甲|示例乙)[：:]',line)
        if h or a:
            flush(n-1)
            lines,start = [],n
            if h:
                level=len(h[1]); stack=[(l,t) for l,t in stack if l<level]+[(level,h[2])]; label=None
            else: label=a[1]
        lines.append(line)
    flush(len(text.splitlines()))
    return result

def classification(path):
    if path.suffix=='.docx': return 'expression-rule','DOCX writing reference, not examination evidence'
    if path.suffix=='.pdf': return 'fact-reference','Report PDF; claims unverified, not an authoritative examination source'
    if 'persona' in path.as_posix() or '人设' in path.name or owners(path.name) or path.name.startswith(('01_','02_','03_')):
        return 'expression-rule','Persona / expression / risk-rule asset'
    if path.suffix=='.md': return 'production-sop','Production instructions, templates or experiment plans; not historical results'
    return 'unknown','No supported classification'

def build():
    chunks,files,groups=[],[],{}
    for path in sorted(source.rglob('*')):
        if path.is_file(): groups.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(),[]).append(path)
    for digest,paths in groups.items():
        path=paths[0]
        sources=[dict(path=p.relative_to(source).as_posix(),modifiedAt=p.stat().st_mtime,associatedPersonas=sorted(owners(p.as_posix()))) for p in paths]
        name=sources[0]['path']
        record=dict(path=name,sha256=digest,sources=sources,modifiedAt=path.stat().st_mtime,dateMeaning='filesystem modification only; not publication date')
        for alias in sources[1:]: files.append(dict(alias,sha256=digest,status='duplicate',reason=name))
        try:
            metadata = {}
            if path.suffix=='.pdf':
                metadata = {str(k):str(v) for k,v in (PdfReader(path).metadata or {}).items() if 'date' in str(k).lower()}
            elif path.suffix=='.docx':
                with zipfile.ZipFile(path) as z:
                    if 'docProps/core.xml' in z.namelist():
                        core=ET.fromstring(z.read('docProps/core.xml'))
                        metadata={e.tag.split('}')[-1]:e.text for e in core if e.tag.split('}')[-1] in ('created','modified')}
            record['embeddedDateMetadata']=metadata
            if path.suffix=='.md': sections=markdown_sections(path.read_text(encoding='utf-8-sig'))
            elif path.suffix=='.pdf': sections=[('PDF text extraction',f'page {i+1}',p.extract_text() or '',None) for i,p in enumerate(PdfReader(path).pages)]
            elif path.suffix=='.docx':
                with zipfile.ZipFile(path) as z:
                    tree=ET.fromstring(z.read('word/document.xml')); ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                    sections=[('Writing reference',f'paragraph {i+1}',''.join(t.text or '' for t in p.findall('.//w:t',ns)),None) for i,p in enumerate(tree.findall('.//w:p',ns))]
            else:
                files.append(dict(record,status='excluded',reason='metadata, not retrieval evidence')); continue
            count=0
            file_owners=set().union(*(owners(s['path']) for s in sources))
            kind,kind_reason=classification(path)
            for heading,location,text,label in sections:
                text=text.encode('utf-8','replace').decode('utf-8')
                scope=owners(label or heading) or file_owners
                mentioned=owners(text)
                if len(mentioned)>1 or (scope and mentioned and not mentioned.issubset(scope)):
                    persona,reason='mixed','Conflicting or multiple account mentions in section'
                elif len(scope)==1: persona,reason=next(iter(scope)),'Explicit label / inherited heading / source account'
                elif len(mentioned)==1: persona,reason=next(iter(mentioned)),'Account mention in unassigned section: conservative restriction'
                elif path.suffix=='.docx' and file_owners=={'demoa','demob'}: persona,reason='shared','Identical writing reference provided for both accounts; aliases retained'
                elif not file_owners and (path.name.startswith(('00_','03_','04_','05_')) or 'controller' in name or path.suffix=='.pdf'): persona,reason='shared','Common production resource / report without account-specific content'
                else: persona,reason='unknown','No explicit common scope or account provenance'
                for offset in range(0,len(text),600):
                    part=text[offset:offset+720]
                    if len(part.strip())<15: continue
                    dates=re.findall(r'20\d{2}(?:[-年/.]\d{1,2}(?:[-月/.]\d{1,2}日?)?)?',part)
                    chunks.append(dict(id=hashlib.sha256((name+location+str(offset)+part).encode()).hexdigest(),path=name,sha256=digest,sources=sources,heading=heading,location=location,offset=offset,text=part,persona=persona,personaReason=reason,kind=kind,kindReason=kind_reason,verified=False,publicationDate=None,temporal=dict(status='unknown',publicationDate='unknown',applicableDate='unknown',dateMentions=dates,embeddedDateMetadata=metadata,reason='Text date mentions, document creation dates and filesystem times do not establish publication or current validity'),tags=[t for t in ['GESP','CSP','Python','C++','Scratch','2026'] if t.lower() in part.lower()]))
                    count+=1
            files.append(dict(record,status='indexed' if count else 'empty',chunks=count,reason='Text only; embedded images not OCR processed' if path.suffix=='.pdf' else None))
        except Exception as exc: files.append(dict(record,status='failed',reason=str(exc)))
    return dict(schemaVersion=2,files=files,chunks=chunks)
if __name__=='__main__':
    kb=build(); output=root/'data/knowledge.json'; output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(kb,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(dict(files=len(kb['files']),indexed=sum(f['status']=='indexed' for f in kb['files']),chunks=len(kb['chunks']),failures=[f for f in kb['files'] if f['status']=='failed'])))
