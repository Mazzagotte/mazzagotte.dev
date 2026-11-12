// 8 AM push: what's due today and what's overdue.
import { claim } from './events.js';
import { pushAll } from './push.js';
import { todayLocal } from './util.js';

export async function todoMorning(env) {
  const today = todayLocal(env.TIMEZONE || 'America/Denver');
  if (!(await claim(env, `todo-morning:${today}`))) return;
  const { results } = await env.DB.prepare(
    `SELECT n.text, n.due_on FROM notes n JOIN projects p ON p.id = n.project_id
      WHERE n.kind = 'todo' AND n.done = 0 AND p.archived = 0 AND n.due_on IS NOT NULL AND n.due_on <= ? ORDER BY n.due_on`
  ).bind(today).all();
  if (!results.length) return;
  const late = results.filter((t) => t.due_on < today).length;
  const dueToday = results.length - late;
  const title = [dueToday && `${dueToday} due today`, late && `${late} overdue`].filter(Boolean).join(' · ');
  await pushAll(env, { title: `To-dos: ${title}`, body: results.slice(0, 3).map((t) => '• ' + t.text.slice(0, 60)).join('\n'), url: '/#/todos', tag: 'todos' });
}
