// Root flat config: TypeScript recommended rules, engine purity (@pn/core), named exports only, the
// Firebase facades and the no-hard-coded-copy rule.
import tseslint from 'typescript-eslint';

const namedExportsOnly = 'Named exports only (ARCHITECTURE.md §3).';
const pureRandom = 'Engine is pure: randomness enters only through actions (ARCHITECTURE.md §5).';
const pureTime = 'Engine is pure: time enters only through actions (ARCHITECTURE.md §5).';
const purePlatform = 'Engine is pure: no platform APIs (ARCHITECTURE.md §5).';
const pureUi = 'Engine is pure: no UI framework imports (ARCHITECTURE.md §5).';
const firebaseFacadeMessage =
  'Import Firebase only through src/firebase.ts / src/analytics.ts (Facade)';
const rnFirebaseFacadeMessage =
  'Import Firebase only through src/services/analytics.ts (Facade)';
const i18nTextMessage = 'User-visible text must come from @pn/i18n (ARCHITECTURE.md §5)';
const siteBoundaryMessage =
  'The site imports only @pn/*, npm packages and src/site/**';

// A later object that sets no-restricted-syntax replaces these options, so overrides repeat them.
const noDefaultExport = [
  'error',
  { selector: 'ExportDefaultDeclaration', message: namedExportsOnly },
  {
    selector: "ExportNamedDeclaration > ExportSpecifier[exported.name='default']",
    message: namedExportsOnly,
  },
];
const firebaseDynamicImport = {
  selector: 'ImportExpression[source.value=/^(@firebase\\/|firebase($|\\/))/]',
  message: firebaseFacadeMessage,
};
const rnFirebaseDynamicImport = {
  selector: 'ImportExpression[source.value=/^@react-native-firebase\\//]',
  message: rnFirebaseFacadeMessage,
};
// Selector form of react/jsx-no-literals: letters only, so punctuation, arrows and digits pass.
function noJsxLiterals(message) {
  return [
    { selector: 'JSXText[value=/[A-Za-zÀ-ɏ]/]', message },
    { selector: 'JSXExpressionContainer > Literal[value=/[A-Za-zÀ-ɏ]/]', message },
  ];
}
const siteFacadeImport = '^(\\.\\./)+(analytics|firebase)(\\.ts)?$';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'spikes/**',
      'config/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      // CommonJS tooling files of the RN app (metro, babel, jest)
      'apps/mobile/*.config.js',
      'apps/mobile/.*.js',
      // Same files, cwd-relative: `npm run lint` may run from inside apps/mobile
      // (with --config ../../eslint.config.mjs), where the paths above do not resolve.
      '*.config.js',
      '.*.js',
    ],
  },
  ...tseslint.configs.recommended,

  // Everywhere: named exports only
  {
    rules: {
      'no-restricted-syntax': noDefaultExport,
    },
  },

  // Default-export allow-list: tooling that requires a default export
  {
    files: [
      '**/vite.config.ts',
      '**/vitest.workspace.ts',
      '**/playwright.config.ts',
      'apps/mobile/index.js',
      'eslint.config.mjs',
    ],
    rules: { 'no-restricted-syntax': 'off' },
  },

  // Engine purity (@pn/core): no randomness, no time, no platform, no
  // UI framework. Tests included.
  {
    files: ['apps-modules/core/**'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: pureRandom },
        { object: 'Date', property: 'now', message: pureTime },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: purePlatform },
        { name: 'document', message: purePlatform },
        { name: 'localStorage', message: purePlatform },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: pureUi },
            { name: 'react-dom', message: pureUi },
            { name: 'react-native', message: pureUi },
          ],
          patterns: [{ group: ['react/*', 'react-dom/*', 'react-native/*'], message: pureUi }],
        },
      ],
    },
  },

  // i18n and design tokens: platform-neutral, zero runtime dependencies.
  {
    files: ['apps-modules/i18n/src/**/*.ts', 'apps-modules/design-tokens/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'navigator'],
    },
  },

  // web: Firebase only through the facade, in tests too; dynamic import() included.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          // Anchored regex: a gitignore-style 'firebase' group would also match './firebase'.
          patterns: [{ regex: '^(@firebase/|firebase($|/))', message: firebaseFacadeMessage }],
        },
      ],
      'no-restricted-syntax': [...noDefaultExport, firebaseDynamicImport],
    },
  },
  // site: no static facade imports, in tests too.
  {
    files: ['apps/web/src/site/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^(@firebase/|firebase($|/))', message: firebaseFacadeMessage },
            { regex: siteFacadeImport, message: siteBoundaryMessage },
          ],
        },
      ],
    },
  },
  // site: no hard-coded copy in JSX; the facades load lazily from src/site/client/** only.
  // eslint-plugin-react has no ESLint 10 release, so this is the selector form of
  // react/jsx-no-literals. Repeats the selectors above (rule merge).
  {
    files: ['apps/web/src/site/**/*.{ts,tsx}'],
    ignores: ['apps/web/src/site/client/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        ...noDefaultExport,
        firebaseDynamicImport,
        {
          selector: 'ImportExpression[source.value=/^(\\.\\.\\/)+(analytics|firebase)(\\.ts)?$/]',
          message: siteBoundaryMessage,
        },
        ...noJsxLiterals(i18nTextMessage),
      ],
    },
  },
  {
    files: ['apps/web/src/firebase.ts', 'apps/web/src/analytics.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': noDefaultExport },
  },

  // mobile: RNFirebase only through the facade, dynamic import() included.
  {
    files: ['apps/mobile/**/*.{ts,tsx,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@react-native-firebase/*'], message: rnFirebaseFacadeMessage }] },
      ],
      'no-restricted-syntax': [...noDefaultExport, rnFirebaseDynamicImport],
    },
  },
  {
    files: ['apps/mobile/src/services/analytics.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': noDefaultExport },
  },
  // index.js keeps its default-export allowance but still cannot import RNFirebase dynamically.
  {
    files: ['apps/mobile/index.js'],
    rules: { 'no-restricted-syntax': ['error', rnFirebaseDynamicImport] },
  },
  // mobile screens/components: no hard-coded copy in JSX (same selectors as the site).
  {
    files: ['apps/mobile/src/screens/**/*.tsx', 'apps/mobile/src/components/**/*.tsx'],
    ignores: ['**/*.test.tsx', '**/__fixtures__/**'],
    rules: {
      'no-restricted-syntax': [
        ...noDefaultExport,
        rnFirebaseDynamicImport,
        ...noJsxLiterals(i18nTextMessage),
      ],
    },
  },
);
