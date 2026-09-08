module.exports = {
  root: true,
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:svelte/recommended'],
  plugins: ['@typescript-eslint'],
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022,
    extraFileExtensions: ['.svelte'],
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
  overrides: [
    // Own top-level `parser` would apply unconditionally and clobber the
    // parser that plugin:svelte/recommended's own override sets for
    // *.svelte files, so scope the TS parser to *.ts here instead.
    {
      files: ['*.ts'],
      parser: '@typescript-eslint/parser',
    },
    {
      files: ['*.svelte'],
      parserOptions: {
        parser: '@typescript-eslint/parser',
      },
      rules: {
        // TypeScript resolves identifiers itself, and eslint's own scope
        // analysis cannot see a Svelte component's `generics=` type
        // parameters, so `no-undef` reports every use of one (TextField's
        // `V`) as an undefined variable. This is typescript-eslint's own
        // standing advice for TS sources; here it is scoped to *.svelte,
        // where the parser gap is.
        'no-undef': 'off',
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/'],
};
