// eslint.config.js — flat config (development_guide.md §8.2)
// Preset: @eslint/js recommended, typescript-eslint strictTypeChecked, react, react-hooks, import, prettier.
// `architectureConfigs` (import/no-cycle + ràng buộc import theo thư mục) được export để test TC-ARCH-001 dùng lại.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// ---- Rule bắt buộc (§8.2). 'eslint-comments/require-description' của spec đặt 'off' nên không cần nạp plugin đó.
const restrictedSyntax = [
  {
    selector: "CallExpression[callee.property.name='skip']",
    message: 'Cấm phân trang bằng skip — dùng cursor (createdAt, _id) (CLAUDE.md, D-20).',
  },
  {
    selector: "MemberExpression[object.name='localStorage'][property.name=/^(setItem)$/] > Literal[value=/token/i]",
    message: 'Không lưu token vào localStorage (access token chỉ ở RAM).',
  },
  {
    // Selector trên chỉ khớp khi Literal là con trực tiếp của MemberExpression (không bao giờ xảy ra với
    // localStorage.setItem('token', …)); bổ sung selector theo đúng ý định của spec.
    selector:
      "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem'] > Literal[value=/token/i]",
    message: 'Không lưu token vào localStorage (access token chỉ ở RAM).',
  },
];

export const hustaloRules = {
  'no-console': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description' }],
  'react/no-danger': 'error',
  'react-hooks/rules-of-hooks': 'error',
  'react-hooks/exhaustive-deps': 'error',
  'import/no-cycle': 'error',
  'no-restricted-syntax': ['error', ...restrictedSyntax],
};

// ---- Ràng buộc import theo thư mục (§8.2). Flat config: config sau ghi đè cả rule → mỗi nhóm file liệt kê đủ pattern.
const sharedForbidden = ['mongoose', 'ioredis', 'express', 'socket.io', 'react', 'react-dom'];
const serverForbidden = ['react', 'react-dom'];
const clientForbidden = ['mongoose', 'ioredis'];

const restrict = (paths, patterns) => [
  'error',
  {
    paths: paths.map((name) => ({ name, message: 'Import bị cấm ở thư mục này (development_guide.md §8.2).' })),
    patterns: patterns.map((p) => ({
      ...p,
      message: p.message ?? 'Import bị cấm ở thư mục này (development_guide.md §8.2).',
    })),
  },
];

const toServer = { group: ['**/server/**', '@hustalo/server', '@hustalo/server/*'] };
const toClient = { group: ['**/client/**', '@hustalo/client', '@hustalo/client/*'] };
const nodeBuiltins = { regex: '^node:', message: 'client không dùng module Node (node:*).' };
const realtimeFromRepo = {
  group: ['**/realtime/**', '**/realtime'],
  message: 'Repository không phát event — không import realtime/** (§8.2).',
};
const crossModuleData = {
  group: ['../*/*.repository', '../*/*.model', '../../modules/*/*.repository', '../../modules/*/*.model'],
  message: 'Không import repository/model của module khác — gọi service theo ma trận §5.2 (AC-ARCH-001).',
};

export const architectureConfigs = [
  {
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true, noWarnOnMultipleProjects: true } },
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    },
    rules: { 'import/no-cycle': 'error' },
  },
  {
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(sharedForbidden, [toServer, toClient]) },
  },
  {
    files: ['client/src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': restrict(clientForbidden, [toServer, nodeBuiltins]) },
  },
  {
    files: ['server/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(serverForbidden, [toClient]) },
  },
  {
    files: ['server/src/modules/**/*.ts'],
    rules: { 'no-restricted-imports': restrict(serverForbidden, [toClient, crossModuleData]) },
  },
  {
    files: ['server/src/modules/**/*.repository.ts'],
    rules: { 'no-restricted-imports': restrict(serverForbidden, [toClient, crossModuleData, realtimeFromRepo]) },
  },
  {
    // Hợp đồng REST/socket phải nằm ở @hustalo/shared, không khai báo z.* trong controller/handler (§8.2).
    files: ['server/src/**/*.controller.ts', 'server/src/**/*.handler.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        {
          selector: "CallExpression[callee.object.name='z']",
          message: 'Hợp đồng REST/socket đặt ở @hustalo/shared (schemas/*), không khai báo z.* ở đây.',
        },
      ],
    },
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'coverage/**',
      'client/playwright-report/**',
      'client/test-results/**',
      'infra/**',
      '.spec/**',
      '.claude/**',
      '**/__arch_fixtures__/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    ...react.configs.flat['jsx-runtime'],
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['client/**/*.{ts,tsx}'],
    rules: { ...react.configs.flat.recommended.rules, ...react.configs.flat['jsx-runtime'].rules },
  },
  {
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...hustaloRules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  ...architectureConfigs,
  {
    // Script Node (CLI) và file cấu hình JS: không type-check, được in ra console.
    files: ['**/*.{js,mjs,cjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { ...tseslint.configs.disableTypeChecked.languageOptions, globals: globals.node },
    rules: { ...tseslint.configs.disableTypeChecked.rules, 'no-console': 'off' },
  },
  {
    // Script chạy trong trình duyệt trước khi bundle tải (theme-init) không có module.
    files: ['client/public/**/*.js'],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: globals.browser,
      sourceType: 'script',
    },
  },
  prettier,
);
