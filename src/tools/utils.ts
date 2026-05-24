import { getSubjectByName } from "../db.js";

/**
 * 检查学生答案是否正确
 */
export function checkAnswer(studentAnswer: string, correctAnswer: string, questionType: string): boolean {
  const sa = studentAnswer.trim().toLowerCase();
  const ca = correctAnswer.trim().toLowerCase();
  if (questionType === "multiple_choice") return sa.charAt(0) === ca.charAt(0);
  return sa.includes(ca) || ca.includes(sa);
}

/**
 * 渲染进度条
 */
export function renderProgressBar(percent: number): string {
  const filled = Math.round(percent / 10);
  return "[" + "█".repeat(filled) + "░".repeat(10 - filled) + `] ${percent}%`;
}

/**
 * 解析题目选项 JSON，返回格式化的选项文本
 */
const OPTIONS_LETTERS = "ABCDEFGHIJ";

export function formatOptions(optionsJson: string | null): string {
  if (!optionsJson) return "";
  try {
    const parsed = JSON.parse(optionsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((opt, i) => `  ${OPTIONS_LETTERS[i] || i}: ${opt}`).join("\n") + "\n";
    }
    return Object.entries(parsed as Record<string, string>)
      .map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n";
  } catch {
    return `  Options: ${optionsJson}\n`;
  }
}

/**
 * 解析 subject 名称并返回 ID，未找到时返回错误提示
 */
export function resolveSubjectId(subjectName: string): { id: number } | { error: string } {
  const s = getSubjectByName(subjectName);
  if (!s) return { error: `Subject "${subjectName}" not found.` };
  return { id: s.id };
}

/**
 * 统一错误消息提取
 */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 获取知识点标签文本
 */
export function getSubjectNames(subject: { id: number; name: string }): string {
  return subject.name;

}
