$ErrorActionPreference='Stop'
$model='Xenova/bge-small-zh-v1.5'
$revision='75c43b069aac4d136ba6bc1122f995fedcfd2781'
$files=@('config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx')
$records=@()
foreach($file in $files){
 $dest=Join-Path "models/$model" $file
 New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
 Invoke-WebRequest "https://huggingface.co/$model/resolve/$revision/$file" -OutFile $dest
 $records+=@{file=$file;bytes=(Get-Item $dest).Length;sha256=(Get-FileHash $dest -Algorithm SHA256).Hash.ToLower()}
 Write-Output "$file $((Get-Item $dest).Length)"
}
@{model=$model;revision=$revision;files=$records} | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 "models/$model/download-manifest.json"
