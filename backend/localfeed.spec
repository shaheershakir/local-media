# Build natively on each target OS. Electron packages the resulting executable.
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

project_root = Path(SPECPATH).parent
hiddenimports = collect_submodules('uvicorn') + collect_submodules('fastapi') + collect_submodules('pillow_heif')
datas = collect_data_files('pillow_heif')

a = Analysis(['app/main.py'], pathex=[str(project_root)], binaries=[], datas=datas, hiddenimports=hiddenimports, hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [], name='localfeed', debug=False, bootloader_ignore_signals=False, strip=False, upx=True, console=False)
