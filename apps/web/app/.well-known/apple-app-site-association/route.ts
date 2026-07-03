export function GET() {
  // Apple App Site Association (AASA): links lesswhelmed.com to the iOS app so
  // iCloud Keychain offers saved credentials on the mobile sign-in screen
  // (webcredentials ↔ ios.associatedDomains in apps/mobile/app.json). Served as
  // a route handler (not a public/ file) so Content-Type is application/json
  // despite the extensionless path. Team ID comes from apps/mobile/eas.json
  // (submit.production.ios.appleTeamId); the suffix is the bundle identifier.
  return Response.json(
    { webcredentials: { apps: ["L7U86T3YRV.dev.copt.sirius"] } },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
