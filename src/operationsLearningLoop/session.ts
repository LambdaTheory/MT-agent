import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeishuCardPayload } from '../notify/feishuApp.js';
import type { PublicTrafficDataReportContext } from '../publicTraffic/types.js';
import { buildOperationsLearningQuestionCard, selectOperationsLearningQuizItems, type OperationsLearningFeedbackOption, type OperationsLearningQuizItem } from './quiz.js';

export interface OperationsLearningFeedbackRecord {
  productId: string;
  feedback: OperationsLearningFeedbackOption;
  reviewerId?: string;
  suggestion?: string;
  questionIndex: number;
  submittedAt: string;
}

export interface OperationsLearningSignals {
  acceptedReasons: Record<string, number>;
  rejectedReasons: Record<string, number>;
  rejectedOperations: Record<string, number>;
  nonRepresentativeProducts: string[];
}

export interface OperationsLearningSession {
  date: string;
  createdAt: string;
  updatedAt: string;
  stoppedAt?: string;
  stoppedBy?: string;
  items: OperationsLearningQuizItem[];
  feedbacks: OperationsLearningFeedbackRecord[];
  learnedSignals: OperationsLearningSignals;
}

export interface OperationsLearningFeedbackInput {
  date?: string;
  productId: string;
  feedback: string;
  questionIndex: number;
  suggestion?: string;
  reviewerId?: string;
}

export interface OperationsLearningSessionResponse {
  text: string;
  card?: FeishuCardPayload;
}

export interface OperationsLearningStopInput {
  date?: string;
  reviewerId?: string;
}

const SESSION_FILE = 'operations-learning-session.json';
const FEEDBACK_OPTIONS = new Set<OperationsLearningFeedbackOption>(['reasonable', 'unreasonable', 'suggested_action', 'not_representative']);
const sessionLocks = new Map<string, Promise<void>>();

function sessionPath(outputDir: string, date: string): string {
  return join(outputDir, date, SESSION_FILE);
}

function emptySignals(): OperationsLearningSignals {
  return { acceptedReasons: {}, rejectedReasons: {}, rejectedOperations: {}, nonRepresentativeProducts: [] };
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function parseFeedback(value: string): OperationsLearningFeedbackOption | null {
  return FEEDBACK_OPTIONS.has(value as OperationsLearningFeedbackOption) ? (value as OperationsLearningFeedbackOption) : null;
}

async function withSessionLock<T>(outputDir: string, date: string, run: () => Promise<T>): Promise<T> {
  const key = sessionPath(outputDir, date);
  const previous = sessionLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(key, previous.then(() => current, () => current));
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (sessionLocks.get(key) === current) sessionLocks.delete(key);
  }
}

function nextUnansweredIndex(session: OperationsLearningSession): number {
  const answered = new Set(session.feedbacks.map((record) => record.productId));
  const index = session.items.findIndex((item) => !answered.has(item.productId));
  return index === -1 ? session.items.length + 1 : index + 1;
}

function currentSessionResponse(session: OperationsLearningSession): OperationsLearningSessionResponse {
  if (session.stoppedAt) return { text: compactSummary(session, 'stopped') };
  const nextIndex = nextUnansweredIndex(session);
  const nextItem = session.items[nextIndex - 1];
  if (!nextItem) return { text: compactSummary(session) };
  return { text: `运营学习 loop 测验 ${session.date}（第 ${nextIndex}/${session.items.length} 题）`, card: buildOperationsLearningQuestionCard(session.date, nextItem, { index: nextIndex, total: session.items.length }) };
}

async function saveSession(outputDir: string, session: OperationsLearningSession): Promise<void> {
  await mkdir(join(outputDir, session.date), { recursive: true });
  await writeFile(sessionPath(outputDir, session.date), `${JSON.stringify(session, null, 2)}\n`, 'utf8');
}

export async function loadOperationsLearningSession(outputDir: string, date: string): Promise<OperationsLearningSession | null> {
  try {
    return JSON.parse(await readFile(sessionPath(outputDir, date), 'utf8')) as OperationsLearningSession;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function startOperationsLearningSession(outputDir: string, context: PublicTrafficDataReportContext): Promise<OperationsLearningSessionResponse> {
  const existing = await loadOperationsLearningSession(outputDir, context.date);
  if (existing && existing.items.length > 0) {
    return currentSessionResponse(existing);
  }

  const items = selectOperationsLearningQuizItems(context);
  if (items.length === 0) return { text: '今日暂无可用于学习的运营候选。' };

  const now = new Date().toISOString();
  const session: OperationsLearningSession = { date: context.date, createdAt: now, updatedAt: now, items, feedbacks: [], learnedSignals: emptySignals() };
  await saveSession(outputDir, session);

  return { text: `运营学习 loop 测验 ${context.date}（第 1/${items.length} 题）`, card: buildOperationsLearningQuestionCard(context.date, items[0], { index: 1, total: items.length }) };
}

function applySignals(session: OperationsLearningSession, item: OperationsLearningQuizItem, feedback: OperationsLearningFeedbackOption): void {
  if (feedback === 'reasonable') {
    for (const reason of item.reasons) increment(session.learnedSignals.acceptedReasons, reason);
    return;
  }
  if (feedback === 'not_representative') {
    if (!session.learnedSignals.nonRepresentativeProducts.includes(item.productId)) session.learnedSignals.nonRepresentativeProducts.push(item.productId);
    return;
  }
  for (const reason of item.reasons) increment(session.learnedSignals.rejectedReasons, reason);
  increment(session.learnedSignals.rejectedOperations, item.recommendedOperation);
}

function compactSummary(session: OperationsLearningSession, status: 'completed' | 'stopped' = 'completed'): string {
  const counts = session.feedbacks.reduce<Record<string, number>>((acc, item) => {
    acc[item.feedback] = (acc[item.feedback] ?? 0) + 1;
    return acc;
  }, {});
  const suggestions = session.feedbacks.filter((item) => item.suggestion).length;
  const title = status === 'stopped' ? `运营学习已停止 ${session.date}` : `运营学习反馈完成 ${session.date}`;
  return [title, `已答 ${session.feedbacks.length}/${session.items.length}`, `合理 ${counts.reasonable ?? 0}，不合理 ${counts.unreasonable ?? 0}，不具代表性 ${counts.not_representative ?? 0}，改写建议 ${suggestions}`].join('\n');
}

export async function summarizeOperationsLearningSession(outputDir: string, date: string): Promise<string> {
  const session = await loadOperationsLearningSession(outputDir, date);
  if (!session) return '还没有找到运营学习测验会话，请先发送“运营学习”。';
  const lines = [`运营学习反馈汇总 ${session.date}`, `已答 ${session.feedbacks.length}/${session.items.length}`];
  for (const feedback of session.feedbacks) {
    lines.push(`${feedback.productId} ${feedback.feedback}${feedback.suggestion ? `：${feedback.suggestion}` : ''}`);
  }
  const accepted = Object.keys(session.learnedSignals.acceptedReasons).length;
  const rejected = Object.keys(session.learnedSignals.rejectedReasons).length + Object.keys(session.learnedSignals.rejectedOperations).length;
  const reviewerCount = new Set(session.feedbacks.map((item) => item.reviewerId).filter(Boolean)).size;
  lines.push(`学习信号：认可原因 ${accepted}，否定信号 ${rejected}，不具代表性商品 ${session.learnedSignals.nonRepresentativeProducts.length}，评审人 ${reviewerCount}`);
  return lines.join('\n');
}

export async function summarizeOperationsLearningHistory(outputDir: string): Promise<string> {
  const entries = await readdir(outputDir, { withFileTypes: true }).catch(() => []);
  const dates = entries.filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name)).map((entry) => entry.name).sort();
  const sessions: OperationsLearningSession[] = [];
  for (const date of dates) {
    const session = await loadOperationsLearningSession(outputDir, date);
    if (session) sessions.push(session);
  }
  if (sessions.length === 0) return '还没有找到运营学习测验会话，请先发送“运营学习”。';

  const reviewerCounts = new Map<string, number>();
  let answered = 0;
  let total = 0;
  for (const session of sessions) {
    answered += session.feedbacks.length;
    total += session.items.length;
    for (const feedback of session.feedbacks) {
      if (feedback.reviewerId) reviewerCounts.set(feedback.reviewerId, (reviewerCounts.get(feedback.reviewerId) ?? 0) + 1);
    }
  }

  const lines = ['运营学习历史汇总', `会话 ${sessions.length}`, `已答 ${answered}/${total}`];
  for (const [reviewerId, count] of Array.from(reviewerCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    lines.push(`${reviewerId} ${count}`);
  }
  return lines.join('\n');
}

export async function handleOperationsLearningFeedback(outputDir: string, input: OperationsLearningFeedbackInput): Promise<OperationsLearningSessionResponse> {
  if (!input.date) return { text: '还没有找到运营学习测验会话，请先发送“运营学习”。' };
  return withSessionLock(outputDir, input.date, async () => {
    const session = await loadOperationsLearningSession(outputDir, input.date!);
    if (!session) return { text: '还没有找到运营学习测验会话，请先发送“运营学习”。' };
    if (session.stoppedAt) return { text: compactSummary(session, 'stopped') };

    const feedback = parseFeedback(input.feedback);
    if (!feedback) return { text: `无法识别的运营学习反馈：${input.feedback}。` };
    const item = session.items[input.questionIndex - 1];
    if (!item || item.productId !== input.productId) return { text: '没有找到对应的运营学习题目。' };
    if (session.feedbacks.some((record) => record.productId === item.productId)) return { text: '这道题已经记录过反馈，请继续处理当前题卡。' };

    const record: OperationsLearningFeedbackRecord = { productId: item.productId, feedback, questionIndex: input.questionIndex, submittedAt: new Date().toISOString() };
    if (input.reviewerId) record.reviewerId = input.reviewerId;
    if (input.suggestion) record.suggestion = input.suggestion;
    session.feedbacks.push(record);
    session.learnedSignals = emptySignals();
    for (const saved of session.feedbacks) {
      const savedItem = session.items.find((candidate) => candidate.productId === saved.productId);
      if (savedItem) applySignals(session, savedItem, saved.feedback);
    }
    session.updatedAt = new Date().toISOString();
    await saveSession(outputDir, session);

    return currentSessionResponse(session);
  });
}

export async function handleOperationsLearningStop(outputDir: string, input: OperationsLearningStopInput): Promise<OperationsLearningSessionResponse> {
  if (!input.date) return { text: '还没有找到运营学习测验会话，请先发送“运营学习”。' };
  return withSessionLock(outputDir, input.date, async () => {
    const session = await loadOperationsLearningSession(outputDir, input.date!);
    if (!session) return { text: '还没有找到运营学习测验会话，请先发送“运营学习”。' };
    if (!session.stoppedAt) {
      session.stoppedAt = new Date().toISOString();
      if (input.reviewerId) session.stoppedBy = input.reviewerId;
      session.updatedAt = session.stoppedAt;
      await saveSession(outputDir, session);
    }
    return { text: compactSummary(session, 'stopped') };
  });
}
