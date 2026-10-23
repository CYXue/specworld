/**
 * selftest harness：计数器、section/check、汇总打印（原 selftest.mjs 105-125 行
 * 与结尾汇总逻辑原样搬运）。分域文件只 import { check, section }。
 */
export const VERBOSE = process.argv.includes('--verbose');

export const state = { passed: 0, group: '', failures: [] };

/** failures 的稳定引用：分域文件（如 macDB 匹配表装载兜底）直接 push 用 */
export const failures = state.failures;

export function section(name) {
  state.group = name;
  if (VERBOSE) console.log(`\n── ${name}`);
}

export function check(name, fn) {
  try {
    fn();
    state.passed += 1;
    if (VERBOSE) console.log(`  ✅ ${name}`);
  } catch (e) {
    state.failures.push({ group: state.group, name, message: e.message });
    if (VERBOSE) console.log(`  ❌ ${name}\n     ${e.message.split('\n')[0]}`);
  }
}

/** 全部分域文件加载完后调用；有失败非零退出（原文件结尾汇总原样搬运） */
export function finish() {
  console.log('');
  if (state.failures.length) {
    console.log('─'.repeat(64));
    for (const f of state.failures) {
      console.log(`❌ [${f.group}] ${f.name}`);
      console.log(`   ${f.message.split('\n').slice(0, 4).join('\n')}\n`);
    }
    console.log('─'.repeat(64));
    console.log(`自测结果：${state.passed} 项通过，${state.failures.length} 项失败\n`);
    process.exit(1);
  }
  console.log(`✅ 自测全通过：${state.passed} 项`);
  console.log('');
  console.log('改了解析器或闸门之后请重跑这条命令：node scripts/selftest.mjs');
}
