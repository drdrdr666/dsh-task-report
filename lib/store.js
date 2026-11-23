/**
 * 任务档案的存储与渲染。
 *
 * 设计约束（来自 DSH 插件规范）：
 * - 不向 session 追加自定义事件类型（会让会话无法重开），所以状态落在工作区文件里，
 *   随工作区一起存在、可提交、可跨会话读取。
 * - 纯 node，无运行时依赖，便于在任何 profile 里加载。
 */

import fs from 'node:fs';
import path from 'node:path';

export const DIR_NAME = '.dsh-task';
export const STATE_VERSION = 1;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertSlug(slug) {
    const value = String(slug || '');
    if (!SLUG_RE.test(value)) {
        throw new Error(
            `任务标识不合法：${value || '(空)'}。只允许小写字母、数字和连字符，最长 64，例如 dsh-long-image`,
        );
    }
    return value;
}

export function tasksDir(workspaceDir) {
    return path.join(workspaceDir, DIR_NAME);
}

function statePath(workspaceDir, slug) {
    return path.join(tasksDir(workspaceDir), `${slug}.json`);
}

function activePath(workspaceDir) {
    return path.join(tasksDir(workspaceDir), '.active');
}

export function emptyState(slug, goal) {
    const now = Date.now();
    return {
        version: STATE_VERSION,
        slug,
        goal: goal || '',
        phase: '进行中',
        createdAt: now,
        updatedAt: now,
        done: [],
        doing: '',
        blocked: null,
        // 这两项故意不给默认空数组：收尾时必须"显式交代"，
        // 没传和"传了空"是两种不同的状态，插件要能区分。
        userActions: null,
        sideEffects: { files: [], system: [], processes: [], external: [], credentials: [] },
        sideEffectsTouched: false,
        unverified: null,
        // 验证范围：说"测试通过"时必须同时说清它没覆盖什么。
        coverage: { covered: null, uncovered: null },
        decisions: [],
        value: { did: '', helped: '', reuse: [] },
        next: [],
        closedAt: null,
    };
}

export function load(workspaceDir, slug) {
    const file = statePath(workspaceDir, slug);
    if (!fs.existsSync(file)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!raw || typeof raw !== 'object') return null;
        return { ...emptyState(slug, raw.goal || ''), ...raw };
    } catch {
        return null;
    }
}

export function save(workspaceDir, state) {
    const dir = tasksDir(workspaceDir);
    fs.mkdirSync(dir, { recursive: true });
    state.updatedAt = Date.now();
    fs.writeFileSync(statePath(workspaceDir, state.slug), JSON.stringify(state, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, `${state.slug}.md`), render(state), 'utf8');
    return state;
}

export function setActive(workspaceDir, slug) {
    fs.mkdirSync(tasksDir(workspaceDir), { recursive: true });
    fs.writeFileSync(activePath(workspaceDir), slug, 'utf8');
}

export function getActive(workspaceDir) {
    const file = activePath(workspaceDir);
    if (!fs.existsSync(file)) return null;
    const slug = fs.readFileSync(file, 'utf8').trim();
    return slug || null;
}

export function list(workspaceDir) {
    const dir = tasksDir(workspaceDir);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
            const slug = f.replace(/\.json$/, '');
            const st = load(workspaceDir, slug);
            return st
                ? { slug, goal: st.goal, phase: st.phase, closed: Boolean(st.closedAt), updatedAt: st.updatedAt }
                : { slug, goal: '', phase: '?', closed: false, updatedAt: 0 };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 把 patch 合并进 state，数组字段默认追加，传 null 表示清空。 */
export function merge(state, patch) {
    if (!patch || typeof patch !== 'object') return state;
    const take = (key) => patch[key];

    if (typeof take('goal') === 'string') state.goal = take('goal');
    if (typeof take('phase') === 'string') state.phase = take('phase');
    if (typeof take('doing') === 'string') state.doing = take('doing');

    const addTo = (key, item) => {
        if (!item) return;
        if (!Array.isArray(state[key])) state[key] = [];
        state[key].push(item);
    };
    // 字符串数组按值去重：多次 update 传同一句"未验证项"不该堆成两条。
    const addUniqueString = (key, value) => {
        const text = String(value);
        if (!Array.isArray(state[key])) state[key] = [];
        if (!state[key].includes(text)) state[key].push(text);
    };

    if (Array.isArray(patch.done)) {
        for (const d of patch.done) {
            if (typeof d === 'string') addTo('done', { what: d, evidence: '' });
            else if (d && typeof d === 'object') addTo('done', { what: String(d.what || ''), evidence: String(d.evidence || '') });
        }
    }
    if (Array.isArray(patch.unverified)) for (const u of patch.unverified) addUniqueString('unverified', u);
    if (Array.isArray(patch.next)) for (const n of patch.next) addUniqueString('next', n);
    if (Array.isArray(patch.decisions)) {
        for (const d of patch.decisions) {
            if (d && typeof d === 'object') addTo('decisions', { what: String(d.what || ''), why: String(d.why || '') });
        }
    }
    if (Array.isArray(patch.userActions)) {
        for (const a of patch.userActions) {
            if (typeof a === 'string') addTo('userActions', { action: a, why: '', ifNot: '' });
            else if (a && typeof a === 'object')
                addTo('userActions', { action: String(a.action || ''), why: String(a.why || ''), ifNot: String(a.ifNot || '') });
        }
    }

    if (patch.blocked === null) state.blocked = null;
    else if (patch.blocked && typeof patch.blocked === 'object') {
        state.blocked = {
            reason: String(patch.blocked.reason || ''),
            tried: String(patch.blocked.tried || ''),
            need: String(patch.blocked.need || ''),
        };
    }

    if (patch.sideEffects && typeof patch.sideEffects === 'object') {
        for (const key of ['files', 'system', 'processes', 'external', 'credentials']) {
            const list = patch.sideEffects[key];
            if (!Array.isArray(list)) continue;
            if (!Array.isArray(state.sideEffects[key])) state.sideEffects[key] = [];
            for (const item of list) state.sideEffects[key].push(String(item));
        }
    }

    if (patch.coverage && typeof patch.coverage === 'object') {
        if (!state.coverage || typeof state.coverage !== 'object') state.coverage = { covered: null, uncovered: null };
        if (Array.isArray(patch.coverage.covered)) state.coverage.covered = patch.coverage.covered.map(String);
        if (Array.isArray(patch.coverage.uncovered)) state.coverage.uncovered = patch.coverage.uncovered.map(String);
    }

    if (patch.value && typeof patch.value === 'object') {
        if (typeof patch.value.did === 'string') state.value.did = patch.value.did;
        if (typeof patch.value.helped === 'string') state.value.helped = patch.value.helped;
        if (Array.isArray(patch.value.reuse)) {
            if (!Array.isArray(state.value.reuse)) state.value.reuse = [];
            for (const r of patch.value.reuse) state.value.reuse.push(String(r));
        }
    }

    return state;
}

/** 收尾前检查：这几节必须显式交代过，哪怕内容是"无"。 */
export function checkClose(state) {
    const missing = [];
    if (!state.goal) missing.push('goal（目标原话）');
    if (!state.done.length) missing.push('done（至少一条已完成项，带证据）');
    if (!state.done.some((d) => d.evidence)) missing.push('done[].evidence（验证证据）');
    if (!state.value.did) missing.push('value.did（一句话做成了什么）');
    if (!state.value.helped) missing.push('value.helped（对用户解决了什么）');
    if (state.userActions === undefined || state.userActions === null) {
        missing.push('userActions（待用户操作；没有请显式传空数组）');
    }
    if (state.unverified === undefined || state.unverified === null) {
        missing.push('unverified（未验证项；没有请显式传空数组）');
    }
    const cov = state.coverage || {};
    if (!Array.isArray(cov.covered) || !cov.covered.length) {
        missing.push('coverage.covered（这次验证到底覆盖了什么）');
    }
    if (!Array.isArray(cov.uncovered) || !cov.uncovered.length) {
        missing.push('coverage.uncovered（明确说明没覆盖哪些路径；确实没有写 ["无"]）');
    }
    if (!state.sideEffectsTouched) {
        missing.push('sideEffects（动过什么；确实没动也要传对象）');
    }
    return missing;
}

function bullet(lines, items, fmt) {
    if (!items || !items.length) {
        lines.push('- 无');
        return;
    }
    for (const item of items) lines.push(fmt(item));
}

const fmtTime = (ms) => new Date(ms).toLocaleString('zh-CN', { hour12: false });

export function render(state) {
    const L = [];
    L.push(`# 任务档案：${state.goal || state.slug}`, '');
    L.push(`- 标识：\`${state.slug}\``);
    L.push(`- 阶段：${state.phase}`);
    L.push(`- 创建：${fmtTime(state.createdAt)}`);
    L.push(`- 更新：${fmtTime(state.updatedAt)}`);
    if (state.closedAt) L.push(`- 收尾：${fmtTime(state.closedAt)}`);
    L.push('');

    L.push('## 一、目标', '', state.goal || '_未填写_', '');

    L.push('## 二、已完成（含证据）', '');
    bullet(L, state.done, (d) => `- ${d.what || '(未写)'}${d.evidence ? `\n  - 证据：${d.evidence}` : ''}`);
    L.push('');

    if (state.doing) {
        L.push('## 三、进行中', '', state.doing, '');
    }

    L.push('## 四、阻塞', '');
    if (state.blocked && (state.blocked.reason || state.blocked.need)) {
        L.push(`- 原因：${state.blocked.reason || '未写'}`);
        L.push(`- 已尝试：${state.blocked.tried || '未写'}`);
        L.push(`- 需要谁动手：${state.blocked.need || '未写'}`);
    } else {
        L.push('- 无');
    }
    L.push('');

    L.push('## 五、待用户操作', '');
    bullet(L, state.userActions, (a) => {
        const parts = [`- **${a.action || '(未写)'}**`];
        if (a.why) parts.push(`  - 为什么：${a.why}`);
        if (a.ifNot) parts.push(`  - 不做的后果：${a.ifNot}`);
        return parts.join('\n');
    });
    L.push('');

    L.push('## 六、副作用清单', '');
    const se = state.sideEffects || {};
    const labels = { files: '文件', system: '系统设置', processes: '进程与端口', external: '外部账号', credentials: '凭据' };
    let anySide = false;
    for (const key of Object.keys(labels)) {
        if (Array.isArray(se[key]) && se[key].length) {
            anySide = true;
            L.push(`- ${labels[key]}：`);
            for (const item of se[key]) L.push(`  - ${item}`);
        }
    }
    if (!anySide) L.push('- 无');
    L.push('');

    L.push('## 七、未验证与已知限制', '');
    const cov = state.coverage || {};
    L.push(`- 已验证范围：${Array.isArray(cov.covered) && cov.covered.length ? cov.covered.join('；') : '_未填写_'}`);
    L.push(`- 未覆盖范围：${Array.isArray(cov.uncovered) && cov.uncovered.length ? cov.uncovered.join('；') : '_未填写_'}`);
    L.push('- 其他未验证项：');
    if (Array.isArray(state.unverified) && state.unverified.length) {
        for (const u of state.unverified) L.push(`  - ${u}`);
    } else {
        L.push('  - 无');
    }
    L.push('');

    L.push('## 八、决策记录', '');
    bullet(L, state.decisions, (d) => `- ${d.what}${d.why ? ` —— ${d.why}` : ''}`);
    L.push('');

    L.push('## 九、价值收口', '');
    L.push(`- 做成了什么：${state.value.did || '_未填写_'}`);
    L.push(`- 对用户的帮助：${state.value.helped || '_未填写_'}`);
    if (state.value.reuse && state.value.reuse.length) {
        L.push('- 后续可复用：');
        for (const r of state.value.reuse) L.push(`  - ${r}`);
    }
    L.push('');

    L.push('## 十、下次入口', '');
    bullet(L, state.next, (n) => `- ${n}`);
    L.push('');

    return L.join('\n');
}
