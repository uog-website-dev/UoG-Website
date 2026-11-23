"""Download the audited public AAU image fixture, rejecting drift and unsafe paths."""
import argparse,concurrent.futures,hashlib,json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request,urlopen


def fetch(manifest, directory):
    directory=directory.resolve();directory.mkdir(parents=True,exist_ok=True)
    document=json.loads(manifest.read_text(encoding='utf-8'))
    def asset(entry):
        name,metadata=entry
        url=urlsplit(metadata['url'])
        if url.scheme!='https' or url.hostname not in {'aau.edu.et','volume.aau.edu.et'} or url.username or url.password:
            raise ValueError('Unsupported source host')
        target=(directory/metadata['file']).resolve()
        if not target.is_relative_to(directory):raise ValueError('Unsafe asset path')
        if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()==metadata['sha256']:return name
        with urlopen(Request(metadata['url'],headers={'User-Agent':'UoG CMS local comparison review'}),timeout=45) as response:
            if urlsplit(response.url).hostname not in {'aau.edu.et','volume.aau.edu.et'}:raise ValueError('Unsafe redirect')
            data=response.read(20*1024*1024+1)
        if len(data)>20*1024*1024 or hashlib.sha256(data).hexdigest()!=metadata['sha256']:
            raise ValueError(f'Source image changed or exceeded limits: {name}. Recapture and review the source manifest.')
        target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
        return name
    if len(document['assets'])>50:raise ValueError('Fixture exceeds the bounded image count')
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        names=list(pool.map(asset,document['assets'].items()))
    (directory/'import-manifest.json').write_text(json.dumps(document,ensure_ascii=False,indent=2),encoding='utf-8')
    return {'images':len(names),'directory':str(directory)}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--manifest',type=Path,required=True);parser.add_argument('--directory',type=Path,required=True)
    arguments=parser.parse_args();print(json.dumps(fetch(arguments.manifest,arguments.directory)))
