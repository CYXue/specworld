import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '_work/**',
      'data/**',
      'public/**',
      'coverage/**',
      '*.md',
      'package-lock.json',
      // 根目录 _smoke*.cjs 是 gitignore 的 puppeteer 浏览器回归脚本，刻意用 require，不纳入 lint
      '**/*.cjs',
      // .vue 由 prettier 负责格式化，eslint 不处理（避免引入 vue-eslint-parser 复杂度）
      '**/*.vue',
    ],
  },
  // 仅启用与 TS 适配的推荐规则（js.configs.recommended 的 no-irregular-whitespace /
  // no-control-regex / no-sparse-arrays 会把爬虫脚本里刻意使用的解析模式误判为错误，
  // 超出本次「风格归一」范围，故不引入）
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
    plugins: { import: importPlugin },
    rules: {
      // 不自动删除「未使用」导入，避免误伤带副作用的导入或改变行为
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-namespace': 'off',
      // 风格统一：import 分组排序 + 单引号（与 .prettierrc 一致，prettier 负责其余格式）
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      quotes: ['warn', 'single', { avoidEscape: true }],
    },
  },
  // 必须放在最后：关闭所有与 prettier 冲突的格式化规则
  prettier,
];
