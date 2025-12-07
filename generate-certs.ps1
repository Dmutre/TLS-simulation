Param(
    [string[]]$Nodes = @("A", "B", "C", "D", "E")
)

# Папка secrets біля цього скрипта
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SecretsDir = Join-Path $ScriptDir "secrets"

Write-Host "Creating secrets directory at $SecretsDir"
New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null

# Шляхи до root CA
$RootKey = Join-Path $SecretsDir "rootCA.key"
$RootCrt = Join-Path $SecretsDir "rootCA.crt"

# 1. Генерація root CA, якщо ще немає
if (-Not (Test-Path $RootKey)) {
    Write-Host "Generating root CA private key..."
    openssl genrsa -out $RootKey 4096
} else {
    Write-Host "Root CA key already exists, skipping..."
}

if (-Not (Test-Path $RootCrt)) {
    Write-Host "Generating root CA certificate..."
    openssl req -x509 -new -nodes `
        -key $RootKey `
        -sha256 -days 3650 `
        -out $RootCrt `
        -subj "/C=UA/ST=Kyiv/L=Kyiv/O=MyRootCA/OU=IT/CN=MyRootCA"
} else {
    Write-Host "Root CA certificate already exists, skipping..."
}

# 2. Генерація ключів і сертифікатів для нод
foreach ($Node in $Nodes) {
    Write-Host "Processing node $Node..."

    $NodeDir = Join-Path $SecretsDir ("node_{0}" -f $Node)
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null

    $KeyPath = Join-Path $NodeDir ("{0}.key" -f $Node)
    $CsrPath = Join-Path $NodeDir ("{0}.csr" -f $Node)
    $CrtPath = Join-Path $NodeDir ("{0}.crt" -f $Node)

    if (-Not (Test-Path $KeyPath)) {
        Write-Host "  Generating private key for node $Node..."
        openssl genrsa -out $KeyPath 2048
    } else {
        Write-Host "  Key for node $Node already exists, skipping..."
    }

    Write-Host "  Generating CSR for node $Node..."
    openssl req -new `
        -key $KeyPath `
        -out $CsrPath `
        -subj "/C=UA/ST=Kyiv/L=Kyiv/O=MyOrg/OU=Node/CN=$Node"

    Write-Host "  Signing certificate for node $Node with root CA..."
    openssl x509 -req `
        -in $CsrPath `
        -CA $RootCrt `
        -CAkey $RootKey `
        -CAcreateserial `
        -out $CrtPath `
        -days 365 -sha256

    # Можна почистити CSR, щоб не смітити
    Remove-Item $CsrPath -ErrorAction SilentlyContinue
}

Write-Host "Done!"
Write-Host "Root CA: $RootCrt"
Write-Host "Nodes:"
foreach ($Node in $Nodes) {
    $NodeDir = Join-Path $SecretsDir ("node_{0}" -f $Node)
    $CrtPath = Join-Path $NodeDir ("{0}.crt" -f $Node)
    Write-Host "  $Node -> $CrtPath"
}
