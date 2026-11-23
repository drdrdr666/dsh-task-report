/**
 * dsh-task-report —— 任务档案工具。
 *
 * 解决的问题：一次任务交出去之后，"做到哪了 / 动过什么 / 还要用户做什么 /
 * 哪些没验证 / 这趟到底换来了什么" 这些信息通常只存在于对话正文里，会话一断
 * 就归零，用户还得重新问一遍。本插件把它们沉淀成工作区里的 .dsh-task/<slug>.md，
 * 随工作区存活、可提交、可跨会话读回。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import * as store from './lib/store.js';

export const name = 'dsh-task-report';

export const inject = ['tools'];

const OUTPUT = {
    schema: { type: 'json' },
    render(_args, value) {
        if (!value || typeof value !== 'object') return [{ type: 'text', text: '（无结果）' }];
        if (value.error) return [{ type: 'text', text: `任务档案操作失败：${value.error}` }];
        if (value.missing && value.missing.length) {
            return [
                {
                    type: 'text',
                    text: ['收尾检查未通过，以下内容必须显式交代（没有也要写“无”）：', ...value.missing.map((m) => `- ${m}`)].join('\n'),
                },
            ];
        }
        if (value.markdown) return [{ type: 'text', text: value.markdown }];
        if (value.tasks) {
            const lines = value.tasks.length
                ? value.tasks.map((t) => `- ${t.slug} | ${t.phase}${t.closed ? '（已收尾）' : ''} | ${t.goal || '(无目标)'}`)
                : ['- 还没有任何任务档案'];
            return [{ type: 'text', text: lines.join('\n') }];
        }
        return [{ type: 'text', text: value.summary || '（完成）' }];
    },
};

function workspaceDir(ctx, exec) {
    try {
        if (exec && exec.agent && exec.agent.session) {
            const wd = ctx.get('workingDirectory');
            const dir = wd && typeof wd.get === 'function' ? wd.get(exec.agent.session) : undefined;
            if (dir) return dir;
        }
    } catch {
        /* 退回到进程目录 */
    }
    return process.cwd();
}

function resolveSlug(workspace, args) {
    const explicit = args && args.slug ? String(args.slug) : '';
    if (explicit) return store.assertSlug(explicit);
    const active = store.getActive(workspace);
    if (active) return active;
    throw new Error('没有指定 slug，当前也没有进行中的任务；用 task_report(action:"open", slug:"…", goal:"…") 开一个');
}

export function apply(ctx) {
    ctx.effect(
        () =>
            ctx.tools.register(
                defineTool({
                    name: 'task_report',
                    description:
                        '维护一份跨会话存活的任务档案（工作区 .dsh-task/<slug>.md）：目标、已完成与证据、阻塞、'
                        + '待用户操作、副作用清单、未验证项、决策记录、价值收口。'
                        + '开工时用 open，过程中用 update 增量补记，交付前用 close 触发收尾检查。',
                    parameters: {
                        action: {
                            type: 'string',
                            enum: ['open', 'update', 'close', 'show', 'list'],
                            description:
                                'open 建档案并设为当前任务；update 增量补记；close 校验并收尾（缺项会返回 missing，不写入收尾时间）；'
                                + 'show 读回现有档案；list 列出全部任务。',
                        },
                        slug: {
                            type: 'string',
                            description:
                                '任务标识，小写字母/数字/连字符。open 时必填；其他动作省略则用当前活动任务。',
                        },
                        goal: {
                            type: 'string',
                            description: 'open 时记录目标，尽量用用户的原话。',
                        },
                        patch: {
                            type: 'object',
                            additionalProperties: true,
                            description:
                                'update 时的增量：goal/phase/doing/blocked/null、done[{what,evidence}]、userActions[{action,why,ifNot}]、'
                                + 'sideEffects{files,system,processes,external,credentials}、unverified[]、decisions[{what,why}]、'
                                + 'value{did,helped,reuse[]}、next[]。数组字段为追加语义。',
                        },
                    },
                    output: OUTPUT,
                    isConcurrencySafe: () => false,
                    timeoutMs: 20000,
                    async execute(args, exec) {
                        const workspace = workspaceDir(ctx, exec);
                        const action = String((args && args.action) || '').toLowerCase();

                        try {
                            if (action === 'list') {
                                return { tasks: store.list(workspace) };
                            }

                            if (action === 'open') {
                                const slug = store.assertSlug(args && args.slug);
                                const existing = store.load(workspace, slug);
                                if (existing) {
                                    store.setActive(workspace, slug);
                                    return {
                                        slug,
                                        summary: `任务 ${slug} 已存在（阶段 ${existing.phase}），已设为当前任务`,
                                        markdown: store.render(existing),
                                    };
                                }
                                const state = store.emptyState(slug, args && args.goal ? String(args.goal) : '');
                                store.save(workspace, state);
                                store.setActive(workspace, slug);
                                return {
                                    slug,
                                    summary: `已创建任务档案 ${slug}\n路径：${store.tasksDir(workspace)}/${slug}.md`,
                                    markdown: store.render(state),
                                };
                            }

                            if (action === 'update') {
                                const slug = resolveSlug(workspace, args);
                                const state = store.load(workspace, slug);
                                if (!state) return { error: `找不到任务 ${slug}，先用 open 创建` };
                                store.merge(state, args && args.patch);
                                if (args && args.patch && args.patch.sideEffects) state.sideEffectsTouched = true;
                                store.save(workspace, state);
                                return {
                                    slug,
                                    summary: `已更新任务 ${slug}\n路径：${store.tasksDir(workspace)}/${slug}.md`,
                                    markdown: store.render(state),
                                };
                            }

                            if (action === 'close') {
                                const slug = resolveSlug(workspace, args);
                                const state = store.load(workspace, slug);
                                if (!state) return { error: `找不到任务 ${slug}` };
                                if (args && args.patch) {
                                    store.merge(state, args.patch);
                                    if (args.patch.sideEffects) state.sideEffectsTouched = true;
                                }
                                const missing = store.checkClose(state);
                                if (missing.length) {
                                    store.save(workspace, state);
                                    return { slug, missing };
                                }
                                if (!Object.values(state.sideEffects).some((a) => Array.isArray(a) && a.length)) {
                                    state.sideEffectsTouched = true;
                                }
                                state.closedAt = Date.now();
                                state.phase = '已收尾';
                                store.save(workspace, state);
                                return {
                                    slug,
                                    summary: `任务 ${slug} 已收尾\n路径：${store.tasksDir(workspace)}/${slug}.md`,
                                    markdown: store.render(state),
                                };
                            }

                            if (action === 'show') {
                                const slug = resolveSlug(workspace, args);
                                const state = store.load(workspace, slug);
                                if (!state) return { error: `找不到任务 ${slug}` };
                                return { slug, markdown: store.render(state) };
                            }

                            return { error: `未知 action：${action || '(空)'}，可用 open/update/close/show/list` };
                        } catch (error) {
                            return { error: String((error && error.message) || error) };
                        }
                    },
                }),
            ),
        'dsh-task-report: task_report',
    );
}
