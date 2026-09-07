// Sin firma "Developer ID" (cuesta una membresía Apple), un .app arm64 sin
// firmar ni siquiera ad-hoc dispara el falso "está dañado" de Gatekeeper en
// cuanto trae la marca de cuarentena de una descarga. La firma ad-hoc (`-`)
// no cuesta nada y evita ese bloqueo; el usuario sigue viendo el aviso normal
// de "desarrollador no identificado", con opción de abrir de todas formas.
const { execFileSync } = require('child_process');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath]);
};
