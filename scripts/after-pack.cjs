'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');

/**
 * Sign the packaged macOS app before the dmg is built, with the **stable** self-signed
 * identity when the machine has it and ad-hoc otherwise.
 *
 * Why the identity matters (this is not cosmetic):
 *   - Ad-hoc (`--sign -`) produces a designated requirement of `cdhash H"…"` and nothing
 *     else — a different code identity on every build. macOS keys TCC decisions
 *     (Accessibility, Screen Recording, Full Disk Access, App Management) on that
 *     requirement, so a new version arrives as an unknown app: every permission the user
 *     granted silently stops applying, and System Settings keeps showing the stale row as
 *     ON. That is the "I granted it but it still says not granted" report.
 *   - The self-signed identity yields
 *     `identifier "com.onblog.miaomiao" and certificate leaf = H"…"`, which is stable
 *     across rebuilds, so a grant survives application updates.
 *
 * Either way the app is not notarized, so Gatekeeper still stops a quarantined copy once
 * (allow it in System Settings → Privacy & Security). The identity is created once per
 * machine by scripts/create-signing-identity.sh and kept out of the repository.
 *
 * Signing happens here, in afterPack, so it runs on the exact bundle that goes into the
 * dmg for every architecture. electron-builder's own identity: option stays null: it is
 * easy to get wrong there, and a silently skipped signature is what produces "damaged".
 */
const STABLE_IDENTITY = 'Miaomiao Notes Code Signing';
const REQUIRE_STABLE = process.env.REQUIRE_STABLE_SIGNING === '1';

/** Is the persistent code-signing identity imported in this user's keychain? */
function hasStableIdentity() {
  // No -v: that flag only lists identities whose chain is trusted, and a self-signed root
  // is never trusted. codesign signs with it perfectly well.
  const listed = spawnSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' });
  return `${listed.stdout ?? ''}`.includes(STABLE_IDENTITY);
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const stable = hasStableIdentity();
  if (REQUIRE_STABLE && !stable) {
    throw new Error(
      `REQUIRE_STABLE_SIGNING=1 but "${STABLE_IDENTITY}" is not in the login keychain; ` +
        'run scripts/create-signing-identity.sh once on this build machine',
    );
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const identity = stable ? STABLE_IDENTITY : '-';

  execFileSync('codesign', ['--deep', '--force', '--sign', identity, appPath], {
    stdio: 'inherit',
  });

  // codesign -dv / -d -r- write their reports to stderr, not stdout.
  const verify = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' });
  const info = `${verify.stdout ?? ''}${verify.stderr ?? ''}`;
  const sealed = info.split('\n').find((line) => line.startsWith('Sealed Resources')) ?? '';

  const requirement = spawnSync('codesign', ['-d', '-r-', appPath], { encoding: 'utf8' });
  const designated = `${requirement.stdout ?? ''}${requirement.stderr ?? ''}`
    .split('\n')
    .find((line) => line.includes('designated =>')) ?? '';

  console.log(`[after-pack] signed ${appPath} with ${stable ? STABLE_IDENTITY : 'ad-hoc identity'}`);
  console.log(`[after-pack] ${sealed.trim()}`);
  console.log(`[after-pack] ${designated.replace(/^#\s*/, '').trim()}`);

  if (stable && /cdhash\s+H"/.test(designated)) {
    throw new Error(
      'stable identity was used but the designated requirement is still a cdhash; refusing to build',
    );
  }

  if (!stable) {
    console.warn(
      '[after-pack] WARNING: ad-hoc identity — the designated requirement is a cdhash, so every ' +
        'release is a new code identity and macOS permissions granted to the previous version ' +
        'stop applying. Run scripts/create-signing-identity.sh once to get a stable identity.',
    );
  }
};
