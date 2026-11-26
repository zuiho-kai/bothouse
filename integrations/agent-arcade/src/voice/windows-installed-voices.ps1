# This host reads one UTF-8 JSON request. User text is only passed to
# SynthesizeTextToStreamAsync. No audio device, SSML, or network access.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $type = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
  $streamType = [Windows.Media.SpeechSynthesis.SpeechSynthesisStream, Windows.Media.SpeechSynthesis, ContentType=WindowsRuntime]
  $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
  $voices = @{}
  foreach ($voice in $type::AllVoices) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $key = 'win-' + [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($voice.Id))).Replace('-','').Substring(0,24).ToLowerInvariant() }
    finally { $hash.Dispose() }
    $voices[$key] = $voice
  }
  if ($request.action -eq 'list') {
    $items = @(foreach ($key in ($voices.Keys | Sort-Object)) {
      $v = $voices[$key]
      @{ id=$key; name=$v.DisplayName; locale=$v.Language }
    })
    [Console]::Write((ConvertTo-Json -InputObject $items -Compress))
  } elseif ($request.action -eq 'render' -and $voices.ContainsKey($request.id)) {
    $speaker = $type::new()
    try {
      $speaker.Voice = $voices[$request.id]
      if ($request.compact -eq $true) { $speaker.Options.SpeakingRate = 1.3 }
      $operation = $speaker.SynthesizeTextToStreamAsync($request.text)
      $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
      } | Select-Object -First 1
      $task = $asTask.MakeGenericMethod($streamType).Invoke($null,@($operation))
      $task.Wait()
      if ($task.Result.Size -gt 4194304) { throw 'duration' }
      $source = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result)
      $buffer = [IO.MemoryStream]::new()
      try { $source.CopyTo($buffer); [Console]::Write([Convert]::ToBase64String($buffer.ToArray())) }
      finally { $buffer.Dispose(); $source.Dispose(); $task.Result.Dispose() }
    } finally { $speaker.Dispose() }
  } else { exit 2 }
} catch { exit 1 }
