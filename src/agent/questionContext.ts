export interface CurrentQuestion {
  questionId: number;
  questionText: string;
  subQuestions?: string[];
  progress: {
    currentSubIndex: number;
    solvedSubIndices: number[];
    userAnswers: Record<number, string>;
  };
}

const questionMap = new Map<number, CurrentQuestion>();

export function setCurrentQuestion(userId: number, q: CurrentQuestion): void {
  questionMap.set(userId, q);
}

export function getCurrentQuestion(userId: number): CurrentQuestion | undefined {
  return questionMap.get(userId);
}

export function clearCurrentQuestion(userId: number): void {
  questionMap.delete(userId);
}
