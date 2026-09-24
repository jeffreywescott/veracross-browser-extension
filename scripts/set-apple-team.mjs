// Sets DEVELOPMENT_TEAM on every target of the generated Safari Xcode project, so a regenerated
// project can be signed and run on a device without re-picking the Team in Xcode.
// Team ID comes from $APPLE_TEAM_ID or the git-ignored file .apple-team-id. Does nothing if neither is set.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const proj = 'dist/safari/Parent Digest/Parent Digest.xcodeproj/project.pbxproj';
const team = (process.env.APPLE_TEAM_ID || (existsSync('.apple-team-id') ? readFileSync('.apple-team-id', 'utf8') : '')).trim();

if (!team) {
  console.log('No Apple team set (APPLE_TEAM_ID or .apple-team-id); pick a Team in Xcode under Signing & Capabilities.');
  process.exit(0);
}
if (!/^[A-Z0-9]{10}$/.test(team)) {
  console.error(`"${team}" doesn't look like an Apple team ID (10 letters/digits).`);
  process.exit(1);
}

let src = readFileSync(proj, 'utf8');
src = src.replace(/^\s*DEVELOPMENT_TEAM = [^;]*;\n/gm, '');
let n = 0;
src = src.replace(/^(\s*)(PRODUCT_BUNDLE_IDENTIFIER = [^;]*;)$/gm, (_, indent, line) => {
  n++;
  return `${indent}DEVELOPMENT_TEAM = ${team};\n${indent}${line}`;
});
writeFileSync(proj, src);
console.log(`Set DEVELOPMENT_TEAM=${team} on ${n} build configurations.`);
