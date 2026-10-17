// Видимые выходы фабрики, на которые опирается съёмка: метки задач, ключи статусов коммитов и
// ответы бота. Источник правды - docs/demo/visible-outputs.md в ai-factory, там же контрактный
// тест фабрики; меняются вместе. Других знаний о фабрике у съёмки нет: её ключей, кода и текстов
// сообщений съёмка не берёт.

// Метки задач Jira: состояние процесса фабрики и команды ей.
export const LABELS = {
  story: 'story', // стори из вики: страница с этой меткой
  decision: 'decision', // задача на решение по противоречию стори
  needsDecision: 'needs-decision', // стори ждёт решения
  storyOk: 'story-ok', // стори согласована со знаниями проекта
  agent: 'agent', // отдать задачу агенту фабрики
  agentRunning: 'agent-running',
  agentReview: 'agent-review',
  agentFailed: 'agent-failed', // попытка агента не удалась - провал ожидания
  designOk: 'design-ok',
  designChanges: 'design-changes',
  incident: 'incident', // баг сбоя стенда
} as const;

// Метки с подстановкой: стори из страницы вики, выпуск, роль агента.
export const LABEL_PATTERNS = [/^wiki-\d+$/, /^release-v\d+\.\d+\.\d+$/, /^agent:[a-z-]+$/];

// Ключи статусов коммитов фабрики в репозитории цели.
export const STATUSES = ['factory/verdict', 'factory/judge', 'factory/scan', 'factory/deploy'] as const;

// Ответ бота на сбой команды начинается так (ai-factory images/coordinator/bot.ts, failure()).
export const FAILURE_PREFIXES = ['Не вышло:', 'Не нашлось:', 'Фабрике не хватает доступа'] as const;

// Успешный ответ фабрики на команду - ответом на её сообщение, по началу текста. Другой ответ на
// ту же команду - провал шага с этим текстом, а не ожидание до конца срока.
export const REPLIES: Record<string, RegExp> = {
  librarian: /Источники:/, // ответ библиотекаря со ссылками на источники
  'slice-proposed': /^Сверщик предлагает нарезку /, // !нарезка
  'slice-approved': /^Задачи заведены: /, // !утвердить
  'rule-proposed': /^Правило-кандидат предложено: /, // !правила
  'release-notes': /^## следующий выпуск: /, // !выпуск
  'deploy-confirmed': /^Выкладка v\d+\.\d+\.\d+ подтверждена /, // !выкладка
  daily: /^Дейли фабрики:/, // !дейли
  account: /^Учёт фабрики: /, // !учёт
  'ci-started': /^Перезапустил CI /, // !ci - итог придёт объявлением "CI PR N, ..."
  'e2e-started': /^Запустил e2e на стенде /, // !e2e - итог придёт объявлением с коротким коммитом
};

// Фабрика просит повторить команду, когда площадка временно недоступна: это не итог, а повод
// сказать реплику снова.
export const RETRY = /повторите команду/i;

// Отказ в праве по роли (реестр ролей цели): итог шага самозванца, а не провал.
export const REFUSAL = /^Нельзя /;

// Все известные метки: сценарий может ждать и ставить только их.
export function knownLabel(label: string): boolean {
  return (Object.values(LABELS) as string[]).includes(label) || LABEL_PATTERNS.some((p) => p.test(label));
}
