"""Run node scripts/build-extension.mjs first, then package the installable folder."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(__file__).resolve().parent.parent
out = root / 'public/downloads/matchup-youtube-tv.zip'
out.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for path in sorted((root / 'extension').rglob('*')):
        if path.is_file():
            archive.write(path, Path('matchup-youtube-tv') / path.relative_to(root / 'extension'))
print(out)
