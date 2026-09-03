// Conditional notarization — runs only when Apple credentials are present
// in environment variables. Otherwise prints a warning and exits gracefully.
//
// Required env vars (any one of two auth methods):
//   Method A (classic):
//     APPLE_ID          — your Apple Developer ID email
//     APPLE_APP_SPECIFIC_PASSWORD — App-specific password (generated at https://appleid.apple.com)
//     APPLE_TEAM_ID     — Apple Developer Team ID (10 chars, e.g. A1B2C3D4E5)
//   Method B (recommended, App Store Connect API keys):
//     APPLE_API_KEY     — path to .p8 key file
//     APPLE_API_KEY_ID  — key ID (from App Store Connect)
//     APPLE_API_ISSUER  — issuer ID (UUID from App Store Connect)
//     APPLE_TEAM_ID     — same Team ID
//
// When running on GitHub Actions, set these as repository secrets.

const { notarize } = require('@electron/notarize')

module.exports = async function (context) {
  const { appOutDir, packager, electronPlatformName } = context

  // Only notarize macOS
  if (electronPlatformName !== 'darwin') return

  // Check if credentials are available
  const hasCreds = !!(
    (process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID) ||
    (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER && process.env.APPLE_TEAM_ID)
  )

  if (!hasCreds) {
    console.log('')
    console.log('⚠️  Skipping notarization — no Apple credentials found.')
    console.log('   This build will trigger macOS Gatekeeper warnings ("damaged").')
    console.log('   See docs/macos-release-checklist.md for credentials setup.')
    console.log('   End users can work around with:')
    console.log('     xattr -d com.apple.quarantine /Applications/Narwhal.app')
    console.log('     (or right-click → Open in Finder)')
    console.log('')
    return
  }

  console.log('🔑 Apple credentials found — notarizing...')

  const appPath = `${appOutDir}/${packager.appInfo.productFilename}.app`

  try {
    await notarize({
      appPath,
      teamId: process.env.APPLE_TEAM_ID,
      // Method B (API key) preferred
      ...(process.env.APPLE_API_KEY
        ? {
            key: process.env.APPLE_API_KEY,
            keyId: process.env.APPLE_API_KEY_ID,
            issuerId: process.env.APPLE_API_ISSUER,
          }
        : {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
          }),
    })
    console.log('✅ Notarization succeeded!')
  } catch (err) {
    console.error('❌ Notarization failed:', err.message)
    // Don't fail the build — notarization is a post-release step
    process.exitCode = 0
  }
}
