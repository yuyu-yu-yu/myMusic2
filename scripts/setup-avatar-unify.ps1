$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$venv = Join-Path $root '.venv-avatar'
$python = Join-Path $venv 'Scripts\python.exe'
$requirements = Join-Path $PSScriptRoot 'avatar-unify-requirements.txt'
$modelDir = Join-Path $root 'models\avatar'
$model = Join-Path $modelDir 'isnetis.onnx'

if (-not (Test-Path $python)) {
  python -m venv $venv
}

& $python -m pip install --upgrade pip
& $python -m pip install -r $requirements

New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
if (-not (Test-Path $model)) {
  & $python -c "from huggingface_hub import hf_hub_download; import shutil; p=hf_hub_download('skytnt/anime-seg','isnetis.onnx'); shutil.copyfile(p, r'$model')"
}

& $python -c "import cv2, numpy, onnxruntime, PIL; print('Avatar unification environment ready.'); print('ONNX providers:', onnxruntime.get_available_providers())"
