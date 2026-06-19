// REAL captured GitHub API + raw responses for sindresorhus/slugify, used as
// data-backed test fixtures. Regenerate by re-running the capture script (see the
// git-ingest test plan). Do not hand-edit — the assertions encode these exact
// values (stars 2695, MIT, single JavaScript language, readme.md lowercase, root
// index.js entry, no src/ dir).

export const slugifyMeta = {
  description: "Slugify a string",
  stargazers_count: 2695,
  language: "JavaScript",
  topics: [
    "browser",
    "nodejs",
    "npm-package",
    "slug",
    "slugify",
    "transliteration",
    "url-safe",
  ],
  license: {
    key: "mit",
    name: "MIT License",
    spdx_id: "MIT",
    url: "https://api.github.com/licenses/mit",
  },
  default_branch: "main",
  pushed_at: "2025-09-11T12:11:51Z",
  homepage: null,
  html_url: "https://github.com/sindresorhus/slugify",
  owner: {
    avatar_url: "https://avatars.githubusercontent.com/u/170270?v=4",
  },
};

export const slugifyLanguages = {
  JavaScript: 13667,
};

export const slugifyTree = {
  truncated: false,
  tree: [
    {
      path: ".editorconfig",
      type: "blob",
      size: 175,
    },
    {
      path: ".gitattributes",
      type: "blob",
      size: 19,
    },
    {
      path: ".github",
      type: "tree",
    },
    {
      path: ".github/security.md",
      type: "blob",
      size: 179,
    },
    {
      path: ".github/workflows",
      type: "tree",
    },
    {
      path: ".github/workflows/main.yml",
      type: "blob",
      size: 421,
    },
    {
      path: ".gitignore",
      type: "blob",
      size: 23,
    },
    {
      path: ".npmrc",
      type: "blob",
      size: 19,
    },
    {
      path: "index.d.ts",
      type: "blob",
      size: 5463,
    },
    {
      path: "index.js",
      type: "blob",
      size: 4137,
    },
    {
      path: "license",
      type: "blob",
      size: 1117,
    },
    {
      path: "overridable-replacements.js",
      type: "blob",
      size: 139,
    },
    {
      path: "package.json",
      type: "blob",
      size: 1066,
    },
    {
      path: "readme.md",
      type: "blob",
      size: 5763,
    },
    {
      path: "test.js",
      type: "blob",
      size: 9391,
    },
  ],
};

export const slugifyReadme =
  "# slugify\n\n> Slugify a string\n\nUseful for URLs, filenames, and IDs.\n\nIt handles most major languages, including [German (umlauts)](https://en.wikipedia.org/wiki/Germanic_umlaut), Vietnamese, Arabic, Russian, [and more](https://github.com/sindresorhus/transliterate#supported-languages).\n\n## Install\n\n```sh\nnpm install @sindresorhus/slugify\n```\n\n## Usage\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('I ♥ Dogs');\n//=> 'i-love-dogs'\n\nslugify('  Déjà Vu!  ');\n//=> 'deja-vu'\n\nslugify('fooBar 123 $#%');\n//=> 'foo-bar-123'\n\nslugify('я люблю единорогов');\n//=> 'ya-lyublyu-edinorogov'\n```\n\n## API\n\n### slugify(string, options?)\n\n#### string\n\nType: `string`\n\nString to slugify.\n\n#### options\n\nType: `object`\n\n##### separator\n\nType: `string`\\\nDefault: `'-'`\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('BAR and baz');\n//=> 'bar-and-baz'\n\nslugify('BAR and baz', {separator: '_'});\n//=> 'bar_and_baz'\n\nslugify('BAR and baz', {separator: ''});\n//=> 'barandbaz'\n```\n\n##### lowercase\n\nType: `boolean`\\\nDefault: `true`\n\nMake the slug lowercase.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('Déjà Vu!');\n//=> 'deja-vu'\n\nslugify('Déjà Vu!', {lowercase: false});\n//=> 'Deja-Vu'\n```\n\n##### decamelize\n\nType: `boolean`\\\nDefault: `true`\n\nConvert camelcase to separate words. Internally it does `fooBar` → `foo bar`.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('fooBar');\n//=> 'foo-bar'\n\nslugify('fooBar', {decamelize: false});\n//=> 'foobar'\n```\n\n##### customReplacements\n\nType: `Array<string[]>`\\\nDefault: `[\n\t['&', ' and '],\n\t['🦄', ' unicorn '],\n\t['♥', ' love ']\n]`\n\nAdd your own custom replacements.\n\nThe replacements are run on the original string before any other transformations.\n\nThis only overrides a default replacement if you set an item with the same key, like `&`.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('Foo@unicorn', {\n\tcustomReplacements: [\n\t\t['@', 'at']\n\t]\n});\n//=> 'fooatunicorn'\n```\n\nAdd a leading and trailing space to the replacement to have it separated by dashes:\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('foo@unicorn', {\n\tcustomReplacements: [\n\t\t['@', ' at ']\n\t]\n});\n//=> 'foo-at-unicorn'\n```\n\nAnother example:\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('I love 🐶', {\n\tcustomReplacements: [\n\t\t['🐶', 'dogs']\n\t]\n});\n//=> 'i-love-dogs'\n```\n\n##### preserveLeadingUnderscore\n\nType: `boolean`\\\nDefault: `false`\n\nIf your string starts with an underscore, it will be preserved in the slugified string.\n\nSometimes leading underscores are intentional, for example, filenames representing hidden paths on a website.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('_foo_bar');\n//=> 'foo-bar'\n\nslugify('_foo_bar', {preserveLeadingUnderscore: true});\n//=> '_foo-bar'\n```\n\n##### preserveTrailingDash\n\nType: `boolean`\\\nDefault: `false`\n\nIf your string ends with a dash, it will be preserved in the slugified string.\n\nFor example, using slugify on an input field would allow for validation while not preventing the user from writing a slug.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('foo-bar-');\n//=> 'foo-bar'\n\nslugify('foo-bar-', {preserveTrailingDash: true});\n//=> 'foo-bar-'\n```\n\n##### preserveCharacters\n\nType: `string[]`\\\nDefault: `[]`\n\nPreserve certain characters.\n\nIt cannot contain the `separator`.\n\nFor example, if you want to slugify URLs, but preserve the HTML fragment `#` character.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('foo_bar#baz', {preserveCharacters: ['#']});\n//=> 'foo-bar#baz'\n```\n\n##### locale\n\nType: `string`\\\nDefault: `undefined`\n\nThe locale to use for language-specific transliteration.\n\nSee the [`@sindresorhus/transliterate` package](https://github.com/sindresorhus/transliterate#locale) for more info.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('Räksmörgås');\n//=> 'raeksmoergas'\n\nslugify('Räksmörgås', {locale: 'sv'});\n//=> 'raksmorgas'\n```\n\n##### transliterate\n\nType: `boolean`\\\nDefault: `true`\n\nWhether to transliterate Unicode characters to ASCII.\n\nWhen `false`, non-ASCII characters will be preserved instead of being transliterated. This can improve performance when you don't need transliteration.\n\n```js\nimport slugify from '@sindresorhus/slugify';\n\nslugify('Déjà Vu');\n//=> 'deja-vu'\n\nslugify('Déjà Vu', {transliterate: false});\n//=> 'déjà-vu'\n```\n\n### slugifyWithCounter()\n\nReturns a new instance of `slugify(string, options?)` with a counter to handle multiple occurrences of the same string.\n\n#### Example\n\n```js\nimport {slugifyWithCounter} from '@sindresorhus/slugify';\n\nconst slugify = slugifyWithCounter();\n\nslugify('foo bar');\n//=> 'foo-bar'\n\nslugify('foo bar');\n//=> 'foo-bar-2'\n\nslugify.reset();\n\nslugify('foo bar');\n//=> 'foo-bar'\n```\n\n#### Use-case example of counter\n\nIf, for example, you have a document with multiple sections where each subsection has an example.\n\n```md\n## Section 1\n\n### Example\n\n## Section 2\n\n### Example\n```\n\nYou can then use `slugifyWithCounter()` to generate unique HTML `id`'s to ensure anchors will link to the right headline.\n\n### slugify.reset()\n\nReset the counter\n\n#### Example\n\n```js\nimport {slugifyWithCounter} from '@sindresorhus/slugify';\n\nconst slugify = slugifyWithCounter();\n\nslugify('foo bar');\n//=> 'foo-bar'\n\nslugify('foo bar');\n//=> 'foo-bar-2'\n\nslugify.reset();\n\nslugify('foo bar');\n//=> 'foo-bar'\n```\n\n## Related\n\n- [slugify-cli](https://github.com/sindresorhus/slugify-cli) - CLI for this module\n- [transliterate](https://github.com/sindresorhus/transliterate) - Convert Unicode characters to Latin characters using transliteration\n- [filenamify](https://github.com/sindresorhus/filenamify) - Convert a string to a valid safe filename\n";

export const slugifyPackageJson =
  '{\n\t"name": "@sindresorhus/slugify",\n\t"version": "3.0.0",\n\t"description": "Slugify a string",\n\t"license": "MIT",\n\t"repository": "sindresorhus/slugify",\n\t"funding": "https://github.com/sponsors/sindresorhus",\n\t"author": {\n\t\t"name": "Sindre Sorhus",\n\t\t"email": "sindresorhus@gmail.com",\n\t\t"url": "https://sindresorhus.com"\n\t},\n\t"type": "module",\n\t"exports": {\n\t\t"types": "./index.d.ts",\n\t\t"default": "./index.js"\n\t},\n\t"sideEffects": false,\n\t"engines": {\n\t\t"node": ">=20"\n\t},\n\t"scripts": {\n\t\t"test": "xo && ava"\n\t},\n\t"files": [\n\t\t"index.js",\n\t\t"index.d.ts",\n\t\t"overridable-replacements.js"\n\t],\n\t"keywords": [\n\t\t"string",\n\t\t"slugify",\n\t\t"slug",\n\t\t"url",\n\t\t"url-safe",\n\t\t"urlify",\n\t\t"transliterate",\n\t\t"transliteration",\n\t\t"deburr",\n\t\t"unicode",\n\t\t"ascii",\n\t\t"text",\n\t\t"decamelize",\n\t\t"pretty",\n\t\t"clean",\n\t\t"filename",\n\t\t"id"\n\t],\n\t"dependencies": {\n\t\t"@sindresorhus/transliterate": "^2.0.0",\n\t\t"escape-string-regexp": "^5.0.0"\n\t},\n\t"devDependencies": {\n\t\t"ava": "^6.4.1",\n\t\t"xo": "^1.2.2"\n\t},\n\t"xo": {\n\t\t"rules": {\n\t\t\t"@typescript-eslint/member-ordering": "off"\n\t\t}\n\t}\n}\n';

export const slugifyIndexJs =
  "import escapeStringRegexp from 'escape-string-regexp';\nimport transliterate from '@sindresorhus/transliterate';\nimport builtinOverridableReplacements from './overridable-replacements.js';\n\nconst decamelize = string => string\n\t// Separate capitalized words.\n\t.replaceAll(/([A-Z]{2,})(\\d+)/g, '$1 $2')\n\t.replaceAll(/([a-z\\d]+)([A-Z]{2,})/g, '$1 $2')\n\n\t.replaceAll(/([a-z\\d])([A-Z])/g, '$1 $2')\n\t// `[a-rt-z]` matches all lowercase characters except `s`.\n\t// This avoids matching plural acronyms like `APIs`.\n\t.replaceAll(/([A-Z]+)([A-Z][a-rt-z\\d]+)/g, '$1 $2');\n\nconst removeMootSeparators = (string, separator) => {\n\tconst escapedSeparator = escapeStringRegexp(separator);\n\n\treturn string\n\t\t.replaceAll(new RegExp(`(?:${escapedSeparator}){2,}`, 'g'), separator)\n\t\t.replaceAll(new RegExp(`^(?:${escapedSeparator})|(?:${escapedSeparator})$`, 'g'), '');\n};\n\nconst buildPatternSlug = options => {\n\tlet negationSetPattern = String.raw`a-z\\d`;\n\tnegationSetPattern += options.lowercase ? '' : 'A-Z';\n\n\t// When transliteration is disabled, preserve Unicode characters\n\tif (options.transliterate === false) {\n\t\tnegationSetPattern += String.raw`\\p{L}\\p{N}`;\n\t}\n\n\tif (options.preserveCharacters.length > 0) {\n\t\tfor (const character of options.preserveCharacters) {\n\t\t\tif (character === options.separator) {\n\t\t\t\tthrow new Error(`The separator character \\`${options.separator}\\` cannot be included in preserved characters: ${options.preserveCharacters}`);\n\t\t\t}\n\n\t\t\tnegationSetPattern += escapeStringRegexp(character);\n\t\t}\n\t}\n\n\tconst flags = options.transliterate ? 'g' : 'gu';\n\treturn new RegExp(`[^${negationSetPattern}]+`, flags);\n};\n\nexport default function slugify(string, options) {\n\tif (typeof string !== 'string') {\n\t\tthrow new TypeError(`Expected a string, got \\`${typeof string}\\``);\n\t}\n\n\toptions = {\n\t\tseparator: '-',\n\t\tlowercase: true,\n\t\tdecamelize: true,\n\t\tcustomReplacements: [],\n\t\tpreserveLeadingUnderscore: false,\n\t\tpreserveTrailingDash: false,\n\t\tpreserveCharacters: [],\n\t\ttransliterate: true,\n\t\t...options,\n\t};\n\n\tconst shouldPrependUnderscore = options.preserveLeadingUnderscore && string.startsWith('_');\n\tconst shouldAppendDash = options.preserveTrailingDash && string.endsWith('-');\n\n\tif (options.transliterate) {\n\t\tconst customReplacements = new Map([\n\t\t\t...builtinOverridableReplacements,\n\t\t\t...options.customReplacements,\n\t\t]);\n\n\t\tstring = transliterate(string, {customReplacements, locale: options.locale});\n\t} else if (options.customReplacements.length > 0) {\n\t\t// Apply custom replacements even when transliteration is disabled\n\t\tfor (const [key, value] of options.customReplacements) {\n\t\t\tstring = string.replaceAll(key, value);\n\t\t}\n\t}\n\n\tif (options.decamelize) {\n\t\tstring = decamelize(string);\n\t}\n\n\tconst patternSlug = buildPatternSlug(options);\n\n\tif (options.lowercase) {\n\t\tstring = options.locale ? string.toLocaleLowerCase(options.locale) : string.toLowerCase();\n\t}\n\n\t// Detect contractions/possessives by looking for any word followed by a `'t` or `'s`\n\t// in isolation and then remove it. Handles both straight and curly apostrophes.\n\tstring = string.replaceAll(/([a-zA-Z\\d]+)['\\u2019]([ts])(\\s|$)/g, '$1$2$3');\n\n\tstring = string.replace(patternSlug, options.separator);\n\tstring = string.replaceAll('\\\\', '');\n\n\tif (options.separator) {\n\t\tstring = removeMootSeparators(string, options.separator);\n\t}\n\n\tif (shouldPrependUnderscore) {\n\t\tstring = `_${string}`;\n\t}\n\n\tif (shouldAppendDash) {\n\t\tstring = `${string}-`;\n\t}\n\n\treturn string;\n}\n\nexport function slugifyWithCounter() {\n\tconst occurrences = new Map();\n\n\tconst countable = (string, options) => {\n\t\tstring = slugify(string, options);\n\n\t\tif (!string) {\n\t\t\treturn '';\n\t\t}\n\n\t\tconst stringLower = string.toLowerCase();\n\t\tconst numberless = occurrences.get(stringLower.replace(/(?:-\\d+?)+?$/, '')) || 0;\n\t\tconst counter = occurrences.get(stringLower);\n\t\toccurrences.set(stringLower, typeof counter === 'number' ? counter + 1 : 1);\n\t\tconst newCounter = occurrences.get(stringLower) || 2;\n\t\tif (newCounter >= 2 || numberless > 2) {\n\t\t\tstring = `${string}-${newCounter}`;\n\t\t}\n\n\t\treturn string;\n\t};\n\n\tcountable.reset = () => {\n\t\toccurrences.clear();\n\t};\n\n\treturn countable;\n}\n";
