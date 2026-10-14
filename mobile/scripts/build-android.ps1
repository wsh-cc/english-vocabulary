param(
    [string]$SdkRoot = ('F:\' + [char]0x9879 + [char]0x76EE + '\android-sdk'),
    [string]$JdkRoot = '',
    [string]$GradleCache = '',
    [switch]$SkipWebBuild,
    [switch]$Offline
)
$ErrorActionPreference = 'Stop'
$mobileRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot = Join-Path $mobileRoot 'android'
$toolsRoot = Join-Path $mobileRoot '.tools'
$privateRoot = Join-Path $mobileRoot '.private'
$releaseRoot = Join-Path $mobileRoot 'release'
if (-not $JdkRoot) {
    $candidate = Get-ChildItem -LiteralPath (Join-Path $toolsRoot 'jdk21') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'bin/java.exe') } | Select-Object -First 1
    if ($candidate) { $JdkRoot = $candidate.FullName }
}
if (-not $JdkRoot -or -not (Test-Path -LiteralPath (Join-Path $JdkRoot 'bin/java.exe'))) { throw 'JDK 21 is required; pass -JdkRoot to an isolated JDK 21 directory.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platforms/android-36/android.jar'))) { throw 'Android SDK platform 36 is required.' }
$buildTools = Join-Path $SdkRoot 'build-tools/36.0.0'
if (-not (Test-Path -LiteralPath (Join-Path $buildTools 'apksigner.bat'))) { throw 'Android SDK build-tools 36.0.0 are required.' }
New-Item -ItemType Directory -Force -Path $toolsRoot,$privateRoot,$releaseRoot | Out-Null
$taskPreviousJava = $env:JAVA_HOME
$taskPreviousGradle = $env:GRADLE_USER_HOME
$taskPreviousSdk = $env:ANDROID_SDK_ROOT
$taskPreviousAndroid = $env:ANDROID_HOME
$env:JAVA_HOME = $JdkRoot
if (-not $GradleCache) { $GradleCache = Join-Path $toolsRoot 'gh' }
$env:GRADLE_USER_HOME = [IO.Path]::GetFullPath($GradleCache)
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:ANDROID_HOME = $SdkRoot
$utf8 = New-Object System.Text.UTF8Encoding($false)
# SDK is supplied through ANDROID_HOME: Java Properties and lint disagree on
# Unicode escape sequences when a Windows SDK directory contains Chinese text.
[IO.File]::WriteAllText((Join-Path $androidRoot 'local.properties'), ('# SDK provided by ANDROID_HOME in scripts/build-android.ps1' + [Environment]::NewLine), $utf8)
Push-Location $mobileRoot
try {
    if (-not $SkipWebBuild) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $mobileRoot 'dist/index.html'))) { throw 'Build the mobile web assets before packaging.' }
    & node.exe 'node_modules/@capacitor/cli/bin/capacitor' sync android
    if ($LASTEXITCODE -ne 0) { throw 'Capacitor sync failed.' }
    Push-Location $androidRoot
    try {
        $gradleArgs = @('--no-daemon', '--console=plain', ':app:testDebugUnitTest', ':app:lintRelease', ':app:assembleRelease', ':app:assembleDebugAndroidTest')
        if ($Offline) { $gradleArgs += '--offline' }
        & '.\gradlew.bat' @gradleArgs
        if ($LASTEXITCODE -ne 0) { throw 'Android checks or build failed.' }
    } finally { Pop-Location }

    # Generate once. Never silently replace an existing signing identity.
    $keystore = Join-Path $privateRoot 'wordweave-release.jks'
    $secretsPath = Join-Path $privateRoot 'signing.json'
    if ((Test-Path -LiteralPath $keystore) -ne (Test-Path -LiteralPath $secretsPath)) { throw 'Signing identity is incomplete. Restore the existing .private directory; do not generate a replacement key.' }
    if (-not (Test-Path -LiteralPath $keystore)) {
        $bytes = New-Object byte[] 32
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($bytes) } finally { $random.Dispose() }
        $password = [Convert]::ToBase64String($bytes)
        $secret = @{alias='wordweave-release'; password=$password}
        [IO.File]::WriteAllText($secretsPath, ($secret | ConvertTo-Json -Compress), $utf8)
        $env:WORDWEAVE_SIGNING_PASSWORD = $password
        & (Join-Path $JdkRoot 'bin/keytool.exe') -genkeypair -keystore $keystore -storetype JKS -alias $secret.alias -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Wordweave Personal, OU=Mobile, O=Wordweave, C=CN' -storepass:env WORDWEAVE_SIGNING_PASSWORD -keypass:env WORDWEAVE_SIGNING_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed. Preserve .private and inspect it before retrying.' }
    }
    $secret = Get-Content -Encoding UTF8 -LiteralPath $secretsPath -Raw | ConvertFrom-Json
    $env:WORDWEAVE_SIGNING_PASSWORD = $secret.password
    $unsigned = Join-Path $androidRoot 'app/build/outputs/apk/release/app-release-unsigned.apk'
    $aligned = Join-Path $releaseRoot 'wordweave-0.1.0-aligned.apk'
    $signed = Join-Path $releaseRoot 'wordweave-0.1.0.apk'
    & (Join-Path $buildTools 'zipalign.exe') -f -p 4 $unsigned $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    & (Join-Path $buildTools 'apksigner.bat') sign --ks $keystore --ks-key-alias $secret.alias --ks-pass 'env:WORDWEAVE_SIGNING_PASSWORD' --key-pass 'env:WORDWEAVE_SIGNING_PASSWORD' --v2-signing-enabled true --v3-signing-enabled true --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $signed
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $signed).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText((Join-Path $releaseRoot 'wordweave-0.1.0.apk.sha256'), ($hash + '  wordweave-0.1.0.apk' + [Environment]::NewLine), $utf8)
    Get-Item -LiteralPath $signed | Select-Object FullName,Length
    Write-Output ('SHA-256: ' + $hash)
} finally {
    Pop-Location
    Remove-Item Env:WORDWEAVE_SIGNING_PASSWORD -ErrorAction SilentlyContinue
    $env:JAVA_HOME = $taskPreviousJava
    $env:GRADLE_USER_HOME = $taskPreviousGradle
    $env:ANDROID_SDK_ROOT = $taskPreviousSdk
    $env:ANDROID_HOME = $taskPreviousAndroid
}
