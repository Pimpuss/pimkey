// Windows Hello (visage, empreinte, PIN Windows) via l'API WinRT KeyCredentialManager, appelée par Windows PowerShell.
// Une clé RSA « Pimkey » est créée dans le TPM ; elle ne signe qu'après le geste Hello. La signature d'un défi fixe
// (RSA PKCS#1 v1.5 : toujours la même pour un même défi) sert à dériver la clé qui chiffre la clé du coffre.
// Rien de secret ne passe sur la ligne de commande : le défi n'est pas secret, la signature revient sur la sortie.
const { spawn } = require('node:child_process');

const NAME = 'Pimkey';

// Attente d'une opération WinRT asynchrone depuis PowerShell 5.1 (pas de await natif).
// Toute erreur ressort sur la sortie standard en « ERR:message » (UTF-8, sans la barre de progression ni le CLIXML de stderr).
const PRELUDE = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
trap { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; "ERR:" + ($e.Message -replace '\\s+', ' ').Trim(); exit 1 }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Security.Credentials.KeyCredentialManager, Windows.Security.Credentials, ContentType = WindowsRuntime]
$null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]
$KCM = [Windows.Security.Credentials.KeyCredentialManager]
$CB = [Windows.Security.Cryptography.CryptographicBuffer]
$WRB = [System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions]
`;

// Message lisible tiré du CLIXML de stderr, si PowerShell a planté avant le trap
const fromClixml = (err) => [...err.matchAll(/<S S="Error">([^<]*)<\/S>/g)]
  .map((m) => m[1].replace(/_x000D__x000A_/g, ' ')).join('').replace(/\s+/g, ' ').trim()
  || err.replace(/^#< CLIXML/, '').trim().split(/\r?\n/)[0];

function run(script, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(PRELUDE + script, 'utf16le').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    let err = '';
    ps.stdout.setEncoding('utf8');
    ps.stderr.setEncoding('utf8');
    const timer = setTimeout(() => ps.kill(), timeout);
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split(/\r?\n/).pop() || '';
      if (line.startsWith('OK:')) resolve(line.slice(3));
      else reject(new Error(line.startsWith('ERR:') ? line.slice(4) : fromClixml(err) || 'Windows Hello ne répond pas.'));
    });
  });
}

// Statuts WinRT → messages
const MESSAGES = {
  UserCanceled: 'Windows Hello annulé.',
  NotFound: 'La clé Windows Hello de Pimkey n’existe plus : réactivez Windows Hello dans les Paramètres.',
  UserPrefersPassword: 'Windows Hello annulé.',
  SecurityDeviceLocked: 'Windows Hello est temporairement bloqué : utilisez le mot de passe maître.',
  NotSupported: 'Windows Hello n’est pas configuré sur cet ordinateur.',
};
const explain = (e) => { throw new Error(MESSAGES[e.message] || `Windows Hello : ${e.message}`); };

const isSupported = () => run(`"OK:" + (Await ($KCM::IsSupportedAsync()) ([bool]))`, 20000).then((v) => v === 'True', () => false);

// Signe le défi (base64) ; create : crée d'abord la clé (remplace l'ancienne). → signature (Buffer)
function sign(challenge, create = false) {
  if (!/^[A-Za-z0-9+/=]+$/.test(challenge)) return Promise.reject(new Error('Défi invalide.'));
  const open = create
    ? `Await ($KCM::RequestCreateAsync('${NAME}', [Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])`
    : `Await ($KCM::OpenAsync('${NAME}')) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])`;
  return run(`
$r = ${open}
if ($r.Status -ne 'Success') { "ERR:$($r.Status)"; exit }
$buf = $WRB::AsBuffer([Convert]::FromBase64String('${challenge}'))
$s = Await ($r.Credential.RequestSignAsync($buf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
if ($s.Status -ne 'Success') { "ERR:$($s.Status)"; exit }
# PowerShell 5.1 ne sait pas repasser un IBuffer venu de WinRT (__ComObject) à une méthode : appel par réflexion
"OK:" + $CB.GetMethod('EncodeToBase64String').Invoke($null, @($s.Result))
`).then((b64) => Buffer.from(b64, 'base64'), explain);
}

const remove = () => run(`
$op = $KCM::DeleteAsync('${NAME}')
$t = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod } | Select-Object -First 1).Invoke($null, @($op))
$t.Wait(-1) | Out-Null
"OK:"`, 20000).catch(() => {});

module.exports = { isSupported, sign, remove };
