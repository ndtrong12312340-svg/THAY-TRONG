import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, doc, getDoc, updateDoc, getDocs, query, where } from 'firebase/firestore';
import { useNavigate, useParams } from 'react-router-dom';
import { GoogleGenAI, Type } from '@google/genai';
import { getAI } from '../services/ai';
import { Upload, Loader2, Save, ArrowLeft, Image as ImageIcon, Check, FileText, Edit2, Plus, Trash2, Brain } from 'lucide-react';
import { Link } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import MathText from '../components/MathText';

export default function ExamBuilder() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const { examId } = useParams<{ examId: string }>();
  
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState(50);
  const [assignedClasses, setAssignedClasses] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [answerKeyFile, setAnswerKeyFile] = useState<File | null>(null);
  const [isParsingAnswerKey, setIsParsingAnswerKey] = useState(false);
  const [answerKeyError, setAnswerKeyError] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null);
  const [isLoadingExam, setIsLoadingExam] = useState(!!examId);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>('');
  const [editingOptions, setEditingOptions] = useState<string[]>([]);

  const addQuestion = (type: string) => {
    const newQuestion = {
      id: `q${questions.length + 1}`,
      type,
      content: 'Nhập nội dung câu hỏi mới tại đây...',
      options: type === 'multiple_choice' ? ['', '', '', ''] : (type === 'true_false' ? ['', '', '', ''] : []),
      correctAnswer: type === 'multiple_choice' ? 'A' : (type === 'true_false' ? JSON.stringify([null, null, null, null]) : ''),
      explanation: '',
      imageUrls: []
    };
    setQuestions([...questions, newQuestion]);
  };

  const removeQuestion = (index: number) => {
    if (window.confirm('Bạn có chắc chắn muốn xóa câu hỏi này?')) {
      const newQs = questions.filter((_, i) => i !== index);
      setQuestions(newQs);
    }
  };

  useEffect(() => {
    if (examId) {
      const fetchExam = async () => {
        try {
          const docRef = doc(db, 'exams', examId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.teacherId !== appUser?.uid) {
              setError("Bạn không có quyền chỉnh sửa đề thi này.");
              setIsLoadingExam(false);
              return;
            }
            setTitle(data.title || '');
            setDuration(data.duration || 50);
            setAssignedClasses(data.assignedClasses?.join(', ') || '');
            setStartTime(data.startTime || '');
            setEndTime(data.endTime || '');
            setQuestions(data.questions || []);
          } else {
            setError("Không tìm thấy đề thi.");
          }
        } catch (err) {
          handleFirestoreError(err, OperationType.GET, `exams/${examId}`);
          setError("Lỗi khi tải đề thi.");
        } finally {
          setIsLoadingExam(false);
        }
      };
      fetchExam();
    }
  }, [examId, appUser?.uid]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleAnswerKeyFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAnswerKeyFile(e.target.files[0]);
    }
  };

  const parseAnswerKeyWithAI = async () => {
    if (!answerKeyFile || questions.length === 0) {
      setAnswerKeyError('Vui lòng tải lên file đáp án/lời giải và đảm bảo đã trích xuất câu hỏi ở Bước 1.');
      return;
    }
    setIsParsingAnswerKey(true);
    setAnswerKeyError('');
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(answerKeyFile);
      
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        
        const ai = getAI();
        
        const prompt = `
          Bạn là một chuyên gia phân tích đề thi.
          Hãy đọc file đính kèm (có thể là file ảnh hoặc PDF) chứa đáp án và lời giải chi tiết.
          
          Dưới đây là danh sách các câu hỏi đã được trích xuất từ đề thi (chỉ hiển thị một phần nội dung để bạn đối chiếu):
          ${JSON.stringify(questions.map((q, i) => ({ id: q.id, questionNumber: i + 1, contentSnippet: q.content.substring(0, 150) + '...', type: q.type })))}
          
          Nhiệm vụ của bạn là quét TOÀN BỘ file đính kèm (đặc biệt chú ý phần cuối file hoặc các bảng đáp án) để tìm ĐÁP ÁN ĐÚNG và LỜI GIẢI CHI TIẾT cho TỪNG câu hỏi.
          
          Hãy trả về một mảng JSON. Mỗi phần tử trong mảng có cấu trúc:
          - id: chuỗi (BẮT BUỘC phải khớp chính xác với id của câu hỏi trong danh sách trên, ví dụ: 'q1', 'q2')
          - answer: chuỗi (Nội dung đáp án. BẮT BUỘC PHẢI TÌM VÀ ĐIỀN.
            + Nếu type = 'multiple_choice': 'A', 'B', 'C', hoặc 'D'.
            + Nếu type = 'true_false': chuỗi JSON mảng 4 boolean, ví dụ '[true, false, true, false]'.
            + Nếu type = 'short_answer': chuỗi chứa số đáp án, ví dụ '12.5'.
            + Nếu type = 'essay': Đây là đáp án mẫu hoặc các ý chính cần có để chấm điểm. Hãy trích xuất chi tiết nhất có thể.)
          - explanation: chuỗi (Trích xuất TOÀN BỘ phần lời giải chi tiết. Sử dụng LaTeX cho công thức toán học bọc trong dấu $ $. NẾU KHÔNG CÓ LỜI GIẢI CHI TIẾT, hãy ghi lại đáp án đúng vào đây.)
        `;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: answerKeyFile.type,
                    data: base64Data
                  }
                },
                { text: prompt }
              ]
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["id", "answer"]
                }
              }
            }
          });

          const responseText = response.text || '';
          const cleanJson = responseText.replace(/```json|```/g, '').trim();
          const parsedAnswers = JSON.parse(cleanJson || '[]');
          
          // Match answers with current questions by ID
          const newQs = questions.map(q => {
            const matchingAnswer = parsedAnswers.find((a: any) => a.id === q.id);
            if (matchingAnswer) {
              let finalExplanation = matchingAnswer.explanation || q.explanation;
              if (!finalExplanation || finalExplanation.trim() === '') {
                finalExplanation = `Đáp án đúng là: ${matchingAnswer.answer}`;
              }
              return {
                ...q,
                correctAnswer: matchingAnswer.answer,
                explanation: finalExplanation
              };
            }
            return q;
          });

          setQuestions(newQs);
          alert('Đã cập nhật đáp án thành công!');
        } catch (err: any) {
          console.error("AI Parsing Answer Key Error:", err);
          const errMsg = err.message || JSON.stringify(err);
          if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            setAnswerKeyError("Hệ thống AI đã hết lượt sử dụng (Quota Exceeded). Vui lòng thử lại vào ngày mai.");
          } else {
            setAnswerKeyError("Lỗi khi nhận diện đáp án: " + err.message);
          }
        } finally {
          setIsParsingAnswerKey(false);
        }
      };
    } catch (err: any) {
      setAnswerKeyError("Lỗi đọc file: " + err.message);
      setIsParsingAnswerKey(false);
    }
  };

  const parseExamWithAI = async () => {
    if (!file) return;
    setIsParsing(true);
    setError('');
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      
      reader.onload = async () => {
        const base64Data = (reader.result as string).split(',')[1];
        
        const ai = getAI();
        
        const prompt = `
          Bạn là một chuyên gia phân tích đề thi. Nhiệm vụ của bạn là trích xuất TOÀN BỘ dữ liệu từ file PDF đề thi (bao gồm Câu hỏi, Đáp án, và Lời giải chi tiết) một cách CHÍNH XÁC TUYỆT ĐỐI.
          Đặc biệt lưu ý: File PDF có thể chứa hình ảnh, công thức phức tạp. Hãy phân tích kỹ toàn bộ nội dung.

          QUY TRÌNH BÓC TÁCH VÀ TÁCH BIỆT DỮ LIỆU (CỰC KỲ QUAN TRỌNG):
          Mỗi câu hỏi trong đề thi thường có phần "Đề bài" và phần "Lời giải/Đáp án" (nằm ngay dưới câu hỏi hoặc ở cuối file). Bạn PHẢI tách biệt chúng rõ ràng:
          
          1. TRƯỜNG \`content\` (NỘI DUNG CÂU HỎI):
          - CHỈ chứa nội dung của đề bài.
          - LỆNH CẤM: TUYỆT ĐỐI KHÔNG được chứa bất kỳ từ ngữ nào thuộc về phần giải thích (ví dụ: "Lời giải", "Giải", "Hướng dẫn giải", "Đáp án", "Chọn A", "Ta có...").
          - DẤU HIỆU DỪNG: Khi đang đọc câu hỏi mà gặp các từ "Lời giải", "Giải", "HDG", bạn PHẢI DỪNG LẠI NGAY, không đưa phần tiếp theo vào \`content\`.

          2. TRƯỜNG \`options\` (CÁC LỰA CHỌN):
          - Trích xuất 4 đáp án A, B, C, D (nếu là trắc nghiệm nhiều lựa chọn) hoặc 4 ý a, b, c, d (nếu là đúng/sai).

          3. TRƯỜNG \`explanation\` (LỜI GIẢI CHI TIẾT):
          - Đưa TOÀN BỘ nội dung của phần "Lời giải", "Hướng dẫn giải" vào đây.
          - Nếu đề thi có phần lời giải ở cuối file, hãy tìm và ghép đúng lời giải cho từng câu hỏi.
          - Sử dụng LaTeX cho công thức toán học.

          4. TRƯỜNG \`correctAnswer\` (ĐÁP ÁN ĐÚNG):
          - ƯU TIÊN NHẬN DIỆN VÀ ĐIỀN ĐẦY ĐỦ.
          - Đọc kỹ phần lời giải hoặc bảng đáp án để tìm đáp án đúng.
          - Trắc nghiệm nhiều lựa chọn: Điền 'A', 'B', 'C', hoặc 'D'.
          - Trắc nghiệm đúng/sai: Điền chuỗi JSON mảng 4 boolean, ví dụ '[true, false, true, false]'.
          - Trả lời ngắn: Điền chuỗi chứa số đáp án, ví dụ '12.5'.

          QUY TẮC VỀ TOÁN HỌC VÀ HÌNH ẢNH:
          1. MỌI công thức toán học PHẢI được bọc trong dấu $ (cho công thức trên cùng dòng) hoặc $$ (cho công thức đứng riêng một dòng). Không dùng \\( \\) hay \\[ \\].
          2. TUYỆT ĐỐI KHÔNG sử dụng các gói LaTeX vẽ hình như TikZ, tkz-tab, pstricks... vì hệ thống web không hỗ trợ render các gói này.
          3. ĐỐI VỚI BẢNG BIẾN THIÊN VÀ BẢNG XÉT DẤU: BẮT BUỘC dùng môi trường \\begin{array} ... \\end{array} cơ bản của LaTeX để vẽ. Dùng \\nearrow (mũi tên lên) và \\searrow (mũi tên xuống) để thể hiện sự biến thiên. KHÔNG dùng tkz-tab.
          Ví dụ cách vẽ bảng biến thiên hợp lệ:
          $$
          \\begin{array}{|c|lcccccr|}
          \\hline
          x & -\\infty & & -1 & & 1 & & +\\infty \\\\
          \\hline
          y' & & + & 0 & - & 0 & + & \\\\
          \\hline
          y & & & 3 & & & & +\\infty \\\\
          & & \\nearrow & & \\searrow & & \\nearrow & \\\\
          & -\\infty & & & & -1 & & \\\\
          \\hline
          \\end{array}
          $$
          4. ĐỐI VỚI ĐỒ THỊ HÀM SỐ HOẶC HÌNH VẼ HÌNH HỌC: Không thể vẽ bằng array, hãy bỏ qua hình vẽ và KHÔNG chèn bất kỳ dòng chữ nào (như "[CẦN THÊM ẢNH ĐỒ THỊ/HÌNH VẼ]") vào nội dung. Giáo viên sẽ tự xem đề gốc và thêm ảnh sau.

          CẤU TRÚC ĐỀ THI THƯỜNG GẶP:
          1. Trắc nghiệm nhiều lựa chọn (thường 12 câu)
          2. Trắc nghiệm đúng/sai (thường 4 câu, mỗi câu 4 ý a, b, c, d)
          3. Trả lời ngắn (thường 6 câu)
          4. Tự luận (Các câu hỏi yêu cầu giải chi tiết, tính toán dài)
          
          Phần tự luận thường nằm ở cuối đề hoặc xen kẽ. Hãy nhận diện chính xác.

          Hãy trả về một mảng JSON các câu hỏi. Mỗi câu hỏi có cấu trúc:
          - id: chuỗi (ví dụ: 'q1', 'q2')
          - type: 'multiple_choice' | 'true_false' | 'short_answer' | 'essay'
          - content: chuỗi (Nội dung câu hỏi thuần túy. KHÔNG CHỨA LỜI GIẢI. Sử dụng LaTeX cho công thức toán học, bọc trong dấu $ $)
          - options: mảng chuỗi (Đối với multiple_choice BẮT BUỘC PHẢI LÀ MẢNG 4 PHẦN TỬ [A, B, C, D] RIÊNG BIỆT. KHÔNG đưa tất cả vào 1 chuỗi. Nếu trong đề là "A.1 B.2 C.3 D.4" thì bạn PHẢI tách thành ["1", "2", "3", "4"]. Đối với true_false là 4 phát biểu a, b, c, d. short_answer và essay thì để mảng rỗng)
          - correctAnswer: chuỗi (BẮT BUỘC ĐIỀN NẾU CÓ THỂ. Với tự luận, đây là đáp án mẫu ngắn gọn hoặc kết quả cuối cùng)
          - explanation: chuỗi (BẮT BUỘC ĐIỀN NẾU CÓ LỜI GIẢI TRONG FILE. Với tự luận, đây là hướng dẫn chấm hoặc các bước giải chi tiết)
        `;

        try {
          const response = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: file.type,
                    data: base64Data
                  }
                },
                { text: prompt }
              ]
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    type: { type: Type.STRING },
                    content: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctAnswer: { type: Type.STRING },
                    explanation: { type: Type.STRING }
                  },
                  required: ["id", "type", "content"]
                }
              }
            }
          });

          const responseText = response.text || '';
          const cleanJson = responseText.replace(/```json|```/g, '').trim();
          const parsedQuestions = JSON.parse(cleanJson || '[]');
          
          // Process questions
          const processedQuestions = parsedQuestions.map((q: any) => {
            // Initialize correctAnswer for true_false if empty
            if (q.type === 'true_false' && !q.correctAnswer) {
              q.correctAnswer = '[null, null, null, null]';
            }
            if (q.options && Array.isArray(q.options)) {
              // Defensive fix for concatenated options in a single string
              if (q.type === 'multiple_choice' && q.options.length === 1) {
                const singleStr = q.options[0];
                const parts = singleStr.split(/\s*[A-D][\.\:\)]\s*/).filter((s: string) => s.trim() !== '');
                if (parts.length === 4) {
                  q.options = parts;
                }
              }

              q.options = q.options.map((opt: string, i: number) => {
                const letter = q.type === 'true_false' ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i);
                let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                return cleanOpt || opt;
              });
            }
            return q;
          });

          setQuestions(processedQuestions);
        } catch (err: any) {
          console.error("AI Parsing Error:", err);
          const errMsg = err.message || JSON.stringify(err);
          if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            setError("Hệ thống AI đã hết lượt sử dụng (Quota Exceeded). Vui lòng thử lại vào ngày mai.");
          } else {
            setError("Lỗi khi phân tích đề thi: " + err.message);
          }
        } finally {
          setIsParsing(false);
        }
      };
    } catch (err: any) {
      setError("Lỗi đọc file: " + err.message);
      setIsParsing(false);
    }
  };

  const processImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 800;
          const MAX_HEIGHT = 800;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#FFFFFF'; // Ensure white background for transparent PNGs
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
          }
          
          resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleImageUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const imgFile = e.target.files?.[0];
    if (!imgFile) return;

    setUploadingImageId(index.toString());
    try {
      const dataUrl = await processImage(imgFile);
      
      const newQs = [...questions];
      if (!newQs[index].imageUrls) {
        newQs[index].imageUrls = [];
      }
      newQs[index].imageUrls.push(dataUrl);
      setQuestions(newQs);
    } catch (err) {
      console.error("Image upload error:", err);
      alert("Lỗi khi xử lý ảnh.");
    } finally {
      setUploadingImageId(null);
      // Reset input value so the same file can be selected again if needed
      e.target.value = '';
    }
  };

  const removeImage = (qIndex: number, imgIndex: number) => {
    const newQs = [...questions];
    newQs[qIndex].imageUrls.splice(imgIndex, 1);
    setQuestions(newQs);
  };

  const handleSaveQuestionContent = (index: number) => {
    const newQs = [...questions];
    newQs[index].content = editingContent;
    if (newQs[index].options && editingOptions.length > 0) {
      newQs[index].options = editingOptions;
    }
    setQuestions(newQs);
    setEditingQuestionIndex(null);
  };

  const handleSaveExam = async (status: 'draft' | 'published') => {
    if (!title || questions.length === 0) {
      setError("Vui lòng nhập tiêu đề và đảm bảo đã có câu hỏi.");
      return;
    }

    const classesArray = assignedClasses.split(',').map(c => c.trim()).filter(c => c);

    try {
      if (examId) {
        // Update existing exam
        const examRef = doc(db, 'exams', examId);
        await updateDoc(examRef, {
          title,
          duration: Number(duration),
          status,
          assignedClasses: classesArray,
          questions,
          startTime,
          endTime
          // Do not update createdAt or teacherId
        });

        // RECALCULATE SUBMISSIONS
        try {
          const submissionsQuery = query(collection(db, 'submissions'), where('examId', '==', examId));
          const submissionsSnapshot = await getDocs(submissionsQuery);
          
          const updatePromises = submissionsSnapshot.docs.map(async (submissionDoc) => {
            const submissionData = submissionDoc.data();
            // answers is stored as JSON string
            const answers = JSON.parse(submissionData.answers || '{}');
            
            let score = 0;
            let incorrectQuestions: string[] = [];

            questions.forEach((q: any) => {
              const studentAnswer = answers[q.id];
              const correctAnswer = q.correctAnswer;

              if (q.type === 'multiple_choice') {
                if (studentAnswer === correctAnswer) {
                  score += 0.25;
                } else {
                  incorrectQuestions.push(q.id);
                }
              } else if (q.type === 'true_false') {
                try {
                  const correctArr = JSON.parse(correctAnswer || '[]');
                  const studentArr = studentAnswer || [];
                  let correctParts = 0;
                  for (let i = 0; i < 4; i++) {
                    if (studentArr[i] === correctArr[i]) {
                      correctParts++;
                      score += 0.25;
                    }
                  }
                  if (correctParts < 4) incorrectQuestions.push(q.id);
                } catch (e) {
                  incorrectQuestions.push(q.id);
                }
              } else if (q.type === 'short_answer') {
                const sAns = String(studentAnswer || '').trim().toLowerCase().replace(/\s+/g, '');
                const cAns = String(correctAnswer || '').trim().toLowerCase().replace(/\s+/g, '');
                if (sAns === cAns && sAns !== '') {
                  score += 0.5;
                } else {
                  incorrectQuestions.push(q.id);
                }
              }
            });

            await updateDoc(doc(db, 'submissions', submissionDoc.id), {
              score,
              incorrectQuestions
            });
          });

          await Promise.all(updatePromises);
        } catch (subErr) {
          console.error("Error recalculating submissions:", subErr);
        }

      } else {
        // Create new exam
        const examData = {
          title,
          teacherId: appUser?.uid,
          duration: Number(duration),
          status,
          assignedClasses: classesArray,
          questions,
          startTime,
          endTime,
          createdAt: new Date().toISOString()
        };
        await addDoc(collection(db, 'exams'), examData);
      }
      navigate('/teacher');
    } catch (error) {
      handleFirestoreError(error, examId ? OperationType.UPDATE : OperationType.CREATE, examId ? `exams/${examId}` : 'exams');
    }
  };

  const updateTrueFalseAnswer = (qIndex: number, optIndex: number, value: boolean) => {
    const newQs = [...questions];
    let currentAns = [];
    try {
      currentAns = JSON.parse(newQs[qIndex].correctAnswer || '[null, null, null, null]');
    } catch (e) {
      currentAns = [null, null, null, null];
    }
    currentAns[optIndex] = value;
    newQs[qIndex].correctAnswer = JSON.stringify(currentAns);
    setQuestions(newQs);
  };

  if (isLoadingExam) {
    return <div className="flex h-screen items-center justify-center">Đang tải đề thi...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center">
            <Link to="/teacher" className="text-gray-500 hover:text-indigo-600 mr-4 transition-colors bg-white p-2 rounded-full shadow-sm hover:shadow-md">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <h1 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">
              {examId ? 'Chỉnh sửa Đề Thi' : 'Tạo Đề Thi Mới'}
            </h1>
          </div>
        </div>

        <div className="bg-indigo-900 shadow-xl sm:rounded-2xl p-6 sm:p-8 mb-8 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Brain className="w-48 h-48" />
          </div>
          <h2 className="text-xl font-bold mb-4 flex items-center">
            <Brain className="w-6 h-6 mr-3 text-indigo-300" />
            Cấu trúc điểm mặc định (Thang điểm 10)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 relative z-10">
            <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
              <div className="text-xs font-bold text-indigo-200 uppercase mb-1">Trắc nghiệm</div>
              <div className="text-2xl font-black">0.25</div>
              <div className="text-xs text-indigo-300 mt-1">điểm / câu đúng</div>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
              <div className="text-xs font-bold text-indigo-200 uppercase mb-1">Đúng / Sai</div>
              <div className="text-2xl font-black">0.25</div>
              <div className="text-xs text-indigo-300 mt-1">điểm / mỗi ý đúng</div>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
              <div className="text-xs font-bold text-indigo-200 uppercase mb-1">Trả lời ngắn</div>
              <div className="text-2xl font-black">0.50</div>
              <div className="text-xs text-indigo-300 mt-1">điểm / câu đúng</div>
            </div>
            <div className="bg-white/10 backdrop-blur-md p-4 rounded-xl border border-white/20">
              <div className="text-xs font-bold text-indigo-200 uppercase mb-1">Tự luận</div>
              <div className="text-2xl font-black">3.00</div>
              <div className="text-xs text-indigo-300 mt-1">điểm tối đa (AI chấm)</div>
            </div>
          </div>
          <p className="mt-4 text-xs text-indigo-200 italic font-medium">* Hệ thống sẽ tự động chấm điểm ngay khi học sinh nộp bài dựa trên barem này.</p>
        </div>

        <div className="bg-white shadow-md sm:rounded-2xl p-6 sm:p-8 mb-8 border border-gray-100">
          <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
            <span className="bg-indigo-100 text-indigo-600 p-2 rounded-lg mr-3">
              <FileText className="w-5 h-5" />
            </span>
            Thông tin chung
          </h2>
          <div className="grid grid-cols-1 gap-y-6 gap-x-6 sm:grid-cols-6">
            <div className="sm:col-span-4">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Tiêu đề đề thi</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" placeholder="VD: Đề kiểm tra học kì I môn Toán" />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Thời gian (phút)</label>
              <input type="number" value={duration} onChange={e => setDuration(Number(e.target.value))} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
            </div>
            <div className="sm:col-span-6">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Giao cho các lớp (cách nhau bằng dấu phẩy)</label>
              <input type="text" value={assignedClasses} onChange={e => setAssignedClasses(e.target.value)} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" placeholder="VD: 12A1, 12A2" />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Thời gian bắt đầu (không bắt buộc)</label>
              <input type="datetime-local" step="1" value={startTime} onChange={e => setStartTime(e.target.value)} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
            </div>
            <div className="sm:col-span-3">
              <label className="block text-sm font-semibold text-gray-700 mb-1">Thời gian kết thúc (không bắt buộc)</label>
              <input type="datetime-local" step="1" value={endTime} onChange={e => setEndTime(e.target.value)} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 shadow-md sm:rounded-2xl p-6 sm:p-8 mb-8 border border-indigo-100">
          <h2 className="text-xl font-bold text-indigo-900 mb-3 flex items-center">
            <span className="bg-indigo-600 text-white p-2 rounded-lg mr-3 shadow-sm">
              <Upload className="w-5 h-5" />
            </span>
            1. Phân tích Đề thi (Tự động trích xuất toàn bộ)
          </h2>
          <p className="text-sm text-indigo-700/80 mb-6 font-medium">Tải lên file PDF đề thi. Hệ thống sẽ tự động nhận diện câu hỏi, đáp án, lời giải chi tiết và công thức Toán học (LaTeX). Hỗ trợ tốt các file PDF chứa ảnh.</p>
          
          <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 bg-white p-4 rounded-xl shadow-sm border border-indigo-50">
            <input type="file" accept=".pdf" onChange={handleFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 cursor-pointer transition-colors" />
            <button
              onClick={parseExamWithAI}
              disabled={!file || isParsing}
              className="w-full sm:w-auto inline-flex justify-center items-center px-6 py-2.5 border border-transparent text-sm font-bold rounded-xl shadow-md text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 transition-all transform hover:-translate-y-0.5 whitespace-nowrap"
            >
              {isParsing ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Upload className="w-5 h-5 mr-2" />}
              {isParsing ? 'Đang phân tích...' : 'Phân tích PDF'}
            </button>
          </div>
          {error && <p className="mt-3 text-sm font-medium text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-100">{error}</p>}
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 shadow-md sm:rounded-2xl p-6 sm:p-8 mb-8 border border-emerald-100">
          <h2 className="text-xl font-bold text-emerald-900 mb-3 flex items-center">
            <span className="bg-emerald-600 text-white p-2 rounded-lg mr-3 shadow-sm">
              <Check className="w-5 h-5" />
            </span>
            2. Trích xuất Đáp án & Lời giải
          </h2>
          <p className="text-sm text-emerald-700/80 mb-6 font-medium">Tải lên file PDF hoặc hình ảnh chứa đáp án và lời giải chi tiết. Hệ thống sẽ tự động tìm và điền đáp án, lời giải cho các câu hỏi đã nhận diện ở bước 1.</p>
          
          <div className="flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 bg-white p-4 rounded-xl shadow-sm border border-emerald-50">
            <input type="file" accept=".pdf,image/*" onChange={handleAnswerKeyFileChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer transition-colors" />
            <button
              onClick={parseAnswerKeyWithAI}
              disabled={!answerKeyFile || isParsingAnswerKey || questions.length === 0}
              className="w-full sm:w-auto inline-flex justify-center items-center px-6 py-2.5 border border-transparent text-sm font-bold rounded-xl shadow-md text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-500 transition-all transform hover:-translate-y-0.5 whitespace-nowrap"
            >
              {isParsingAnswerKey ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <Upload className="w-5 h-5 mr-2" />}
              {isParsingAnswerKey ? 'Đang nhận diện...' : 'Nhận diện đáp án'}
            </button>
          </div>
          {answerKeyError && <p className="mt-3 text-sm font-medium text-rose-600 bg-rose-50 p-3 rounded-lg border border-rose-100">{answerKeyError}</p>}
        </div>

        {questions.length > 0 && (
          <div className="bg-white shadow-md sm:rounded-2xl p-6 sm:p-8 mb-8 border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-gray-800">Danh sách câu hỏi <span className="bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full text-sm ml-2">{questions.length}</span></h2>
            </div>
            
            <div className="space-y-8">
              {questions.map((q, index) => (
                <div key={index} className="border border-gray-200 rounded-2xl p-6 hover:border-indigo-300 transition-colors shadow-sm hover:shadow-md bg-gray-50/50">
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-bold text-lg text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg">Câu {index + 1} <span className="text-sm font-medium text-indigo-500 ml-1">({q.type})</span></span>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => {
                          setEditingQuestionIndex(index);
                          setEditingContent(q.content);
                          setEditingOptions(q.options ? [...q.options] : []);
                        }}
                        className="inline-flex items-center px-4 py-2 border border-indigo-200 shadow-sm text-sm font-semibold rounded-xl text-indigo-700 bg-white hover:bg-indigo-50 transition-colors"
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Sửa dữ kiện
                      </button>
                      <button
                        onClick={() => removeQuestion(index)}
                        className="inline-flex items-center px-4 py-2 border border-rose-200 shadow-sm text-sm font-semibold rounded-xl text-rose-700 bg-white hover:bg-rose-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Xóa
                      </button>
                      <div className="relative">
                        <input 
                          type="file" 
                          accept="image/*" 
                          id={`img-upload-${index}`}
                          className="hidden" 
                          onChange={(e) => handleImageUpload(index, e)}
                        />
                        <label 
                          htmlFor={`img-upload-${index}`}
                          className="cursor-pointer inline-flex items-center px-4 py-2 border border-indigo-200 shadow-sm text-sm font-semibold rounded-xl text-indigo-700 bg-white hover:bg-indigo-50 transition-colors"
                        >
                          {uploadingImageId === index.toString() ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ImageIcon className="w-4 h-4 mr-2" />}
                          Thêm ảnh
                        </label>
                      </div>
                    </div>
                  </div>
                  
                  {editingQuestionIndex === index ? (
                    <div className="mt-4 bg-white p-4 rounded-xl border border-indigo-300 shadow-sm">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nội dung câu hỏi</label>
                      <textarea
                        value={editingContent}
                        onChange={(e) => setEditingContent(e.target.value)}
                        rows={6}
                        className="w-full border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm mb-4"
                        placeholder="Nhập nội dung câu hỏi (hỗ trợ LaTeX)..."
                      />
                      
                      {editingOptions.length > 0 && (
                        <div className="space-y-3">
                          <label className="block text-sm font-medium text-gray-700 mb-2">Các lựa chọn</label>
                          {editingOptions.map((opt, optIdx) => {
                            const letter = q.type === 'true_false' ? String.fromCharCode(97 + optIdx) : String.fromCharCode(65 + optIdx);
                            return (
                              <div key={optIdx} className="flex items-start">
                                <span className="font-medium mr-2 mt-2">{letter}.</span>
                                <textarea
                                  value={opt}
                                  onChange={(e) => {
                                    const newOpts = [...editingOptions];
                                    newOpts[optIdx] = e.target.value;
                                    setEditingOptions(newOpts);
                                  }}
                                  rows={2}
                                  className="flex-1 border border-gray-300 rounded-md p-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-sm"
                                  placeholder={`Nhập lựa chọn ${letter}...`}
                                />
                                <button
                                  onClick={() => {
                                    const newOpts = editingOptions.filter((_, i) => i !== optIdx);
                                    setEditingOptions(newOpts);
                                  }}
                                  className="ml-2 mt-2 text-red-500 hover:text-red-700"
                                  title="Xóa lựa chọn này"
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                          <button
                            onClick={() => setEditingOptions([...editingOptions, ''])}
                            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                          >
                            + Thêm lựa chọn
                          </button>
                        </div>
                      )}

                      <div className="mt-4 flex justify-end space-x-3">
                        <button 
                          onClick={() => setEditingQuestionIndex(null)} 
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg shadow-sm"
                        >
                          Hủy
                        </button>
                        <button 
                          onClick={() => handleSaveQuestionContent(index)} 
                          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-sm"
                        >
                          Lưu
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 bg-white p-4 rounded-xl border border-gray-100 shadow-sm min-w-0 overflow-x-auto">
                      <MathText text={q.content} />
                    </div>
                  )}

                  {q.imageUrls && q.imageUrls.length > 0 && (
                    <div className="mt-3 mb-3 space-y-3">
                      {q.imageUrls.map((url: string, imgIdx: number) => (
                        <div key={imgIdx} className="relative inline-block mr-3">
                          <img src={url} alt={`Hình ảnh câu hỏi ${imgIdx + 1}`} className="max-h-48 rounded border border-gray-200" />
                          <button 
                            onClick={() => removeImage(index, imgIdx)}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 shadow-sm"
                            title="Xóa ảnh"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Fallback for old data */}
                  {q.imageUrl && (!q.imageUrls || q.imageUrls.length === 0) && (
                    <div className="mt-3 mb-3 relative inline-block">
                      <img src={q.imageUrl} alt="Hình ảnh câu hỏi" className="max-h-48 rounded border border-gray-200" />
                      <button 
                        onClick={() => {
                          const newQs = [...questions];
                          newQs[index].imageUrl = null;
                          setQuestions(newQs);
                        }}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 shadow-sm"
                        title="Xóa ảnh"
                      >
                        ×
                      </button>
                    </div>
                  )}
                  
                  {q.options && q.options.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {q.options.map((opt: string, i: number) => {
                        const letter = q.type === 'true_false' ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i);
                        let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                        if (!cleanOpt) cleanOpt = opt;
                        return (
                          <div key={i} className="flex items-start">
                            <span className="font-medium mr-2">{letter}.</span>
                            <div className="flex-1 min-w-0 overflow-x-auto"><MathText text={cleanOpt} /></div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">Đáp án đúng</label>
                    </div>
                    
                    {q.type === 'multiple_choice' && (
                      <div className="flex space-x-2">
                        {['A', 'B', 'C', 'D'].map((letter) => (
                          <button
                            key={letter}
                            onClick={() => {
                              const newQs = [...questions];
                              newQs[index].correctAnswer = letter;
                              setQuestions(newQs);
                            }}
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-medium border ${
                              q.correctAnswer === letter 
                                ? 'bg-indigo-600 text-white border-indigo-600' 
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {letter}
                          </button>
                        ))}
                      </div>
                    )}

                    {q.type === 'true_false' && (
                      <div className="space-y-3">
                        {['a', 'b', 'c', 'd'].map((letter, optIndex) => {
                          let currentAns: any[] = [];
                          try {
                            currentAns = JSON.parse(q.correctAnswer || '[null, null, null, null]');
                          } catch (e) {
                            currentAns = [null, null, null, null];
                          }
                          const isTrue = currentAns[optIndex] === true;
                          const isFalse = currentAns[optIndex] === false;

                          return (
                            <div key={letter} className="flex items-center space-x-4">
                              <span className="font-medium w-6">{letter}.</span>
                              <div className="flex space-x-2">
                                <button
                                  onClick={() => updateTrueFalseAnswer(index, optIndex, true)}
                                  className={`px-3 py-1 rounded text-sm font-medium border ${
                                    isTrue 
                                      ? 'bg-green-600 text-white border-green-600' 
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  Đúng
                                </button>
                                <button
                                  onClick={() => updateTrueFalseAnswer(index, optIndex, false)}
                                  className={`px-3 py-1 rounded text-sm font-medium border ${
                                    isFalse 
                                      ? 'bg-red-600 text-white border-red-600' 
                                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                                  }`}
                                >
                                  Sai
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {q.type === 'short_answer' && (
                      <input 
                        type="text" 
                        value={q.correctAnswer || ''} 
                        onChange={(e) => {
                          const newQs = [...questions];
                          newQs[index].correctAnswer = e.target.value;
                          setQuestions(newQs);
                        }}
                        className="mt-1 block w-full sm:w-1/2 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                        placeholder="Nhập đáp án (ví dụ: 12.5)"
                      />
                    )}

                    {q.type === 'essay' && (
                      <textarea 
                        value={q.correctAnswer || ''} 
                        onChange={(e) => {
                          const newQs = [...questions];
                          newQs[index].correctAnswer = e.target.value;
                          setQuestions(newQs);
                        }}
                        rows={2}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono" 
                        placeholder="Nhập đáp án ngắn gọn hoặc kết quả..."
                      />
                    )}
                  </div>

                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Lời giải chi tiết / Hướng dẫn chấm {q.type === 'essay' && <span className="text-indigo-600 font-bold ml-1">(BẮT BUỘC để AI chấm bài)</span>}
                      </label>
                    </div>
                    <textarea
                      value={q.explanation || ''}
                      onChange={(e) => {
                        const newQs = [...questions];
                        newQs[index].explanation = e.target.value;
                        setQuestions(newQs);
                      }}
                      rows={4}
                      className="mt-1 block w-full border border-gray-300 rounded-xl shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm font-mono text-gray-800"
                      placeholder={q.type === 'essay' ? "Nhập chi tiết hướng dẫn chấm điểm từng bước..." : "Nhập lời giải chi tiết cho câu hỏi..."}
                    />
                    {q.type === 'essay' && (
                      <p className="mt-2 text-xs text-indigo-600 font-medium italic flex items-center">
                        <Brain className="w-4 h-4 mr-1" />
                        AI sẽ bám sát các bước giải này để chấm điểm chi tiết bài làm tự luận.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 pt-6 border-t border-gray-100">
              <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Thêm câu hỏi thủ công</h3>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => addQuestion('multiple_choice')}
                  className="flex items-center px-4 py-2 bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-colors font-bold text-sm border border-indigo-100"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Trắc nghiệm
                </button>
                <button
                  onClick={() => addQuestion('true_false')}
                  className="flex items-center px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl hover:bg-emerald-100 transition-colors font-bold text-sm border border-emerald-100"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Đúng / Sai
                </button>
                <button
                  onClick={() => addQuestion('short_answer')}
                  className="flex items-center px-4 py-2 bg-amber-50 text-amber-700 rounded-xl hover:bg-amber-100 transition-colors font-bold text-sm border border-amber-100"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Trả lời ngắn
                </button>
                <button
                  onClick={() => addQuestion('essay')}
                  className="flex items-center px-4 py-2 bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 transition-colors font-bold text-sm border border-purple-100"
                >
                  <Plus className="w-4 h-4 mr-1.5" /> Tự luận
                </button>
              </div>
            </div>
            
            <div className="mt-8 flex justify-end space-x-4">
              <button
                onClick={() => handleSaveExam('draft')}
                className="inline-flex items-center px-6 py-3 border border-gray-300 shadow-sm text-sm font-bold rounded-xl text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all transform hover:-translate-y-0.5"
              >
                Lưu nháp
              </button>
              <button
                onClick={() => handleSaveExam('published')}
                className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-bold rounded-xl shadow-md text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all transform hover:-translate-y-0.5"
              >
                <Save className="w-5 h-5 mr-2" /> Giao bài
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
