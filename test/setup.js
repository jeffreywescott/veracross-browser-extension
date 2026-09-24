// Gives the parsers a DOMParser under Node (the extension uses the browser's).
import { DOMParser } from 'linkedom';
import { readFileSync } from 'node:fs';

globalThis.DOMParser = DOMParser;

export function fixture(name) {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

export function doc(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}
