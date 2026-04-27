import { GoogleGenAI, Type } from "@google/genai";
import { ExerciseQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateExercise(
  topic: string,
  grade: string,
  type: string,
  count: number
): Promise<ExerciseQuestion[]> {
  const prompt = `Bạn là một giáo viên xuất sắc. Hãy tạo một bài tập về chủ đề: "${topic}", dành cho học sinh trình độ/lớp: "${grade}".
Bao gồm ${count} câu hỏi. Loại câu hỏi: ${type}.
Với mỗi câu hỏi, hãy cung cấp câu hỏi, các lựa chọn (nếu là trắc nghiệm), đáp án đúng và giải thích chi tiết.
Ngôn ngữ: Tiếng Việt.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              question: { type: Type.STRING },
              type: { type: Type.STRING, description: "Loại câu hỏi (ví dụ: Trắc nghiệm, Tự luận, Đúng/Sai)" },
              options: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Các lựa chọn đáp án (chỉ dành cho trắc nghiệm, ví dụ: ['A. ...', 'B. ...', 'C. ...', 'D. ...'])"
              },
              answer: { type: Type.STRING, description: "Đáp án đúng" },
              explanation: { type: Type.STRING, description: "Giải thích chi tiết tại sao lại chọn đáp án này" }
            },
            required: ["id", "question", "type", "answer", "explanation"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) return [];
    
    return JSON.parse(text) as ExerciseQuestion[];
  } catch (error) {
    console.error("Error generating exercise:", error);
    throw new Error("Không thể tạo bài tập lúc này. Vui lòng thử lại sau.");
  }
}
