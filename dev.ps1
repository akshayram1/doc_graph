param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$argsList = @()
if ($BackendOnly) { $argsList += "--backend-only" }
if ($FrontendOnly) { $argsList += "--frontend-only" }

node "$PSScriptRoot/scripts/dev.js" @argsList

