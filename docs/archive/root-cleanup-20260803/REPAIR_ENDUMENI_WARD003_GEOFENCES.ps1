Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repo = "C:\dev\ireps-web"
$projectId = "ireps2"
$serviceAccount = "C:\dev\secrets\ireps2-e72fd9dc94de.json"
$recoveryScript = Join-Path $repo "functions\scripts\tools\geofences\reprocessGeoFenceMembership.js"

$targets = @(
    @{
        Name = "Gf1 W3"
        GeoFenceId = "av1ij2OihfwBOERGD2BU"
        ExpectedLm = "ZA5241"
        ExpectedWard = "ZA5241003"
    },
    @{
        Name = "G2 W3 Sebenzakusakhanya"
        GeoFenceId = "u4bmxNemlbZZ1e7mkA6m"
        ExpectedLm = "ZA5241"
        ExpectedWard = "ZA5241003"
    }
)

function Invoke-RecoveryRun {
    param(
        [Parameter(Mandatory)]
        [hashtable]$Target,

        [Parameter(Mandatory)]
        [ValidateSet("DRY_RUN", "EXECUTE")]
        [string]$Mode
    )

    Write-Host ""
    Write-Host "=============================================="
    Write-Host "$Mode - $($Target.Name)"
    Write-Host "=============================================="
    Write-Host "Geofence ID: $($Target.GeoFenceId)"
    Write-Host "LM:           $($Target.ExpectedLm)"
    Write-Host "Ward:         $($Target.ExpectedWard)"
    Write-Host ""

    $arguments = @(
        $recoveryScript,
        "--project-id", $projectId,
        "--service-account", $serviceAccount,
        "--geofence-id", $Target.GeoFenceId,
        "--expected-lm", $Target.ExpectedLm,
        "--expected-ward", $Target.ExpectedWard
    )

    if ($Mode -eq "EXECUTE") {
        $arguments += "--execute"
    }

    & node @arguments

    if ($LASTEXITCODE -ne 0) {
        throw "$Mode failed for $($Target.Name) with exit code $LASTEXITCODE."
    }

    Write-Host ""
    Write-Host "$Mode completed successfully for $($Target.Name)."
}

Set-Location $repo

Write-Host ""
Write-Host "=============================================="
Write-Host "ENDUMENI WARD 003 GEOFENCE RECOVERY"
Write-Host "=============================================="
Write-Host "Project: $projectId"
Write-Host "Targets: $($targets.Count)"
Write-Host ""

if (-not (Test-Path $repo)) {
    throw "Repository not found: $repo"
}

if (-not (Test-Path $serviceAccount)) {
    throw "Service account not found: $serviceAccount"
}

if (-not (Test-Path $recoveryScript)) {
    throw "Recovery script not found: $recoveryScript"
}

$currentBranch = [string](git branch --show-current)
$currentBranch = $currentBranch.Trim()

if ($LASTEXITCODE -ne 0) {
    throw "Unable to determine the current Git branch."
}

if ($currentBranch -ne "main") {
    throw "Wrong branch. Expected main but found $currentBranch."
}

node --check $recoveryScript

if ($LASTEXITCODE -ne 0) {
    throw "Recovery script syntax validation failed."
}

$devGuardPresent = Select-String `
    -Path $recoveryScript `
    -Pattern 'const DEV_PROJECT_ID = "ireps2";' `
    -Quiet

if (-not $devGuardPresent) {
    throw "Immutable ireps2 DEV guard was not found in the recovery script."
}

$arrayUnionPresent = Select-String `
    -Path $recoveryScript `
    -Pattern "FieldValue.arrayUnion" `
    -Quiet

if (-not $arrayUnionPresent) {
    throw "Atomic FieldValue.arrayUnion membership append was not found."
}

Write-Host "Branch guard:          PASSED"
Write-Host "Syntax validation:     PASSED"
Write-Host "Immutable DEV guard:   PASSED"
Write-Host "Atomic array append:   PASSED"

Write-Host ""
Write-Host "This script will perform Firestore writes after each successful dry run."
Write-Host "It will stop immediately if any dry run, execute run, or verification fails."

foreach ($target in $targets) {
    Invoke-RecoveryRun -Target $target -Mode "DRY_RUN"
    Invoke-RecoveryRun -Target $target -Mode "EXECUTE"
}

Write-Host ""
Write-Host "=============================================="
Write-Host "WARD 003 RECOVERY COMPLETE"
Write-Host "=============================================="

$reportFolder = Join-Path $repo "functions\scripts\tools\geofences\reports"

foreach ($target in $targets) {
    Write-Host ""
    Write-Host "$($target.Name) reports:"

    Get-ChildItem `
        -Path $reportFolder `
        -Filter "reprocess_geofence_$($target.GeoFenceId)_*.json" `
        -File `
        -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 4 |
    ForEach-Object {
        Write-Host "  $($_.FullName)"
    }
}

Write-Host ""
Write-Host "Both Ward 003 geofences completed dry-run, execute, and post-write verification."
