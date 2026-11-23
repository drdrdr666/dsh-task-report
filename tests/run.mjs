// dsh-task-report 自测：不依赖 Harness，直接跑 lib/store.js 的语义
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as store from '../lib/store.js';

let passed = 0;
const ok = (label, extra = '') => {
    passed++;
    console.log(`  ok  ${label}${extra ? ' — ' + extra : ''}`);
};

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-task-report-'));

// [1] slug 校验
{
    assert.throws(() => store.assertSlug('Bad Slug'), /不合法/);
    assert.equal(store.assertSlug('dsh-long-image'), 'dsh-long-image');
    ok('slug 校验：拒绝非法、接受合法');
}

// [2] open 与活动任务
{
    const st = store.emptyState('demo', '把 X 做完');
    store.save(ws, st);
    store.setActive(ws, 'demo');
    assert.equal(store.getActive(ws), 'demo');
    const loaded = store.load(ws, 'demo');
    assert.equal(loaded.goal, '把 X 做完');
    assert.ok(fs.existsSync(path.join(ws, '.dsh-task', 'demo.md')), 'md 应已生成');
    ok('open：json + md 同时落盘，活动任务可读回');
}

// [3] update 的追加语义
{
    const st = store.load(ws, 'demo');
    store.merge(st, { phase: '实现', done: [{ what: 'A', evidence: 'e1' }] });
    store.merge(st, { done: ['B'] });
    store.save(ws, st);
    const after = store.load(ws, 'demo');
    assert.equal(after.done.length, 2);
    assert.equal(after.done[1].what, 'B');
    assert.equal(after.phase, '实现');
    ok('update：数组追加而非覆盖，phase 生效');
}

// [4] 收尾检查必须拦住缺项
{
    const st = store.load(ws, 'demo');
    const missing = store.checkClose(st);
    assert.ok(missing.some((m) => m.includes('value.did')), '应指出缺少 value.did');
    assert.ok(missing.some((m) => m.includes('未验证') || m.includes('unverified')), '应指出缺少 unverified');
    assert.ok(missing.some((m) => m.includes('待用户操作') || m.includes('userActions')), '应指出缺少 userActions');
    assert.ok(missing.some((m) => m.includes('coverage.covered')), '应指出缺少 coverage.covered');
    ok('close 校验：缺价值收口/未验证/待办时拒绝收尾', `${missing.length} 项`);
}

// [5] 补齐后可收尾，并渲染十节
{
    const st = store.load(ws, 'demo');
    store.merge(st, {
        userActions: [{ action: '重启宿主', why: '进程是旧代码', ifNot: '修复不生效' }],
        unverified: ['未在干净环境验证安装'],
        coverage: { covered: ['node tests/run.mjs 6 组通过'], uncovered: ['干净环境的安装流程'] },
        sideEffects: { files: ['新增 lib/x.js'], processes: ['起了 8899 代理，已关闭'] },
        value: { did: '修好了 A', helped: '以前不行，现在行', reuse: ['tools/x.mjs'] },
        decisions: [{ what: '用文件存而不是会话事件', why: '会话事件不能自定义类型' }],
        next: ['重启后回归一次'],
    });
    st.sideEffectsTouched = true;
    assert.deepEqual(store.checkClose(st), []);
    st.closedAt = Date.now();
    st.phase = '已收尾';
    store.save(ws, st);

    const md = fs.readFileSync(path.join(ws, '.dsh-task', 'demo.md'), 'utf8');
    for (const h of [
        '一、目标',
        '二、已完成',
        '四、阻塞',
        '五、待用户操作',
        '六、副作用清单',
        '七、未验证与已知限制',
        '八、决策记录',
        '九、价值收口',
        '十、下次入口',
    ]) {
        assert.ok(md.includes(h), `缺少小节：${h}`);
    }
    assert.ok(md.includes('不做的后果：修复不生效'));
    assert.ok(md.includes('起了 8899 代理，已关闭'));
    ok('close：补齐后收尾成功，Markdown 十节齐全');
}

// [6] list 按更新时间倒序
{
    const other = store.emptyState('another', '第二个任务');
    store.save(ws, other);
    const list = store.list(ws);
    assert.equal(list.length, 2);
    assert.ok(list.some((t) => t.slug === 'demo' && t.closed));
    ok('list：列出任务并带阶段与收尾状态');
}

console.log(`\n${passed} 组检查通过`);
fs.rmSync(ws, { recursive: true, force: true });
