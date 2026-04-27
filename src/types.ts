export interface ExerciseQuestion {
  id: string;
  question: string;
  type: string;
  options?: string[];
  answer: string;
  explanation: string;
}

export interface ExerciseConfig {
  topic: string;
  grade: string;
  questionType: string;
  count: number;
}
