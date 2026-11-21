import config from '@iobroker/eslint-config';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                // No allowDefaultProject here: the root tsconfig.json already includes "*.mjs",
                // and listing the same files in both makes the project service refuse to parse
                // them ("was included by allowDefaultProject but also was found in the project
                // service").
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // React widget sources: the React plugin config, the hooks rules, and a few type-aware rules
        // relaxed for the loosely typed widget data of vis-2.
        files: ['src-widgets/src/**/*.{ts,tsx}'],
        ...react.configs.flat.recommended,
        plugins: {
            react,
            'react-hooks': reactHooks,
        },
        languageOptions: {
            ...react.configs.flat.recommended.languageOptions,
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        settings: { react: { version: 'detect' } },
        rules: {
            ...react.configs.flat.recommended.rules,
            ...reactHooks.configs.recommended.rules,
            'react/react-in-jsx-scope': 'off',
            'react/prop-types': 'off',
            'react/no-unescaped-entities': 'off',
            'react/display-name': 'off',
            // Prettier formatting is not enforced on the widget sources; lint is about code quality.
            'prettier/prettier': 'off',
            // The data of a widget is `Record<string, any>` in the vis-2 types: the "unsafe" rules would
            // only produce noise.
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            'jsdoc/no-types': 'off',
            'jsdoc/require-returns-description': 'off',
            // Widget data is `any`; return types are not required on every callback.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
        },
    },
    {
        // node:test: describe() and it() return promises the runner waits for
        files: ['src/**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        ignores: [
            'src-admin/**/*',
            'admin/**/*',
            'node_modules/**/*',
            'src-widgets/node_modules/**/*',
            'src-widgets/build/**/*',
            // Dev-only stub of the web adapter, served verbatim - not a source file and not
            // covered by any tsconfig, so the project service cannot parse it.
            'src-widgets/public/**/*',
            'widgets/**/*',
            'test/**/*',
            'build/**/*',
            'tmp/**/*',
            '.**/*',
        ],
    },
    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',

            '@typescript-eslint/no-require-imports': 'off',
        },
    },
];
