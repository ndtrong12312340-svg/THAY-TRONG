import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, addDoc, collection, updateDoc, arrayUnion } from 'firebase/firestore';
import { GoogleGenAI, Type } from '@google/genai';
import { getAI } from '../services/ai';
import MathText from '../components/MathText';
import { Clock, AlertCircle, ChevronLeft, CheckCircle, BookOpen, Loader2, Upload, Send } from 'lucide-react';

export default function TakeExam() {
  const { examId } = useParams<{ examId: string }>();
  const { appUser } = useAuth();
  const navigate = useNavigate();

  const [exam, setExam] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [essayImages, setEssayImages] = useState<Record<string, string[]>>({});
  const [uploadingEssayId, setUploadingEssayId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeInputId, setActiveInputId] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [submittedResult, setSubmittedResult] = useState<{score: number, incorrectQuestions: string[]} | null>(null);

  useEffect(() => {
    const fetchExam = async () => {
      if (!examId) return;
      try {
        setError(null);
        const docRef = doc(db, 'exams', examId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          
          const now = new Date().getTime();
          const startTime = data.startTime ? new Date(data.startTime).getTime() : null;
          const endTime = data.endTime ? new Date(data.endTime).getTime() : null;
          
          if ((startTime && now < startTime) || (endTime && now > endTime)) {
            alert('Đề thi này hiện không mở.');
            navigate('/student');
            return;
          }

          setExam({ id: docSnap.id, ...data });
          setTimeLeft(data.duration * 60); // convert to seconds
        } else {
          setError('Không tìm thấy đề thi.');
        }
      } catch (err: any) {
        console.error("Error fetching exam:", err);
        if (err.message && err.message.includes('Quota')) {
          setError('Hệ thống đang quá tải (vượt quá giới hạn truy cập miễn phí của Firebase). Vui lòng thử lại sau.');
        } else {
          setError('Đã xảy ra lỗi khi tải đề thi. Vui lòng thử lại.');
        }
      }
    };
    fetchExam();
  }, [examId]);

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) {
      if (timeLeft === 0 && !isSubmitting) {
        handleSubmit();
      }
      return;
    }
    const timer = setInterval(() => {
      setTimeLeft(prev => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleAnswerChange = (questionId: string, value: any) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const calculateScore = () => {
    let score = 0;
    let incorrectQuestions: string[] = [];

    exam.questions.forEach((q: any) => {
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
          const correctArr = JSON.parse(correctAnswer);
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

    return { score, incorrectQuestions };
  };

  const handleSubmit = async () => {
    if (!exam || !appUser) return;
    setIsSubmitting(true);

    try {
      const { score, incorrectQuestions } = calculateScore();
      let finalScore = score;
      let essayGrades: Record<string, any> = {};
      const essayQuestions = exam.questions.filter((q: any) => q.type === 'essay');

      // Automatic AI grading for essays if they exist
      if (essayQuestions.length > 0) {
        const ai = getAI();
        
        for (const q of essayQuestions) {
          const images = essayImages[q.id] || [];
          if (images.length > 0) {
            let attempts = 0;
            let graded = false;

            while (attempts < 3 && !graded) {
              try {
                const prompt = `
                  Bạn là một giám khảo chấm thi vô cùng nghiêm ngặt và chính xác. 
                  Nhiệm vụ của bạn là tự động chấm điểm bài làm tự luận của học sinh dựa trên ảnh chụp, ĐÁP ÁN và BAREM ĐIỂM do giáo viên cung cấp.
                  
                  CÂU HỎI: ${q.content}
                  ĐÁP ÁN CHUẨN CỦA GIÁO VIÊN: ${q.correctAnswer || ""}
                  BAREM ĐIỂM / LỜI GIẢI CHI TIẾT: ${q.explanation || "Không có barem cụ thể (mặc định tổng điểm câu này là 1.0 điểm)."}
                  
                  QUY TẮC CHẤM ĐIỂM BẮT BUỘC (MỆNH LỆNH):
                  1. XÁC ĐỊNH ĐIỂM TỐI ĐA (maxScore): Hãy đọc kỹ BAREM ĐIỂM để xác định tổng điểm tối đa của câu hỏi này. Nếu không tìm thấy, mặc định maxScore = 1.0.
                  2. SO SÁNH TRỰC TIẾP: Đối chiếu bài làm của học sinh với ĐÁP ÁN CHUẨN và BAREM ĐIỂM. 
                  3. TÍNH ĐIỂM BƯỚC: Chỉ cho điểm những ý/bước đã làm đúng theo phân bổ điểm của từng câu mà giáo viên đã cho trong barem. Thiếu bước nào trừ điểm bước đó.
                  4. KHÔNG VƯỢT TRẦN: ĐIỂM SỐ (score) TUYỆT ĐỐI KHÔNG ĐƯỢC CHẤM QUÁ SỐ ĐIỂM CỦA CÂU ĐÓ TRONG BAREM (score <= maxScore).
                  5. CÁCH GIẢI KHÁC: Nếu học sinh giải bằng cách khác hợp logic và ra cùng đáp án, hãy cho điểm tương đương. Nếu kết quả sai, chỉ cho điểm quá trình làm đúng.
                  
                  TRẢ VỀ KẾT QUẢ DƯỚI DẠNG JSON CHUẨN: 
                  { 
                    "maxScore": number, // Tổng số điểm của câu hỏi theo barem
                    "score": number, // Điểm số thực tế mà học sinh đạt được (đảm bảo <= maxScore)
                    "feedback": string // Nhận xét rõ ràng: đúng/sai chỗ nào so với barem, lý do trừ điểm là gì.
                  }
                `;

                const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: [{
                    role: 'user',
                    parts: [
                      ...images.map((img: string) => ({
                        inlineData: { mimeType: 'image/jpeg', data: img.split(',')[1] }
                      })),
                      { text: prompt }
                    ]
                  }],
                  config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        maxScore: { type: Type.NUMBER },
                        score: { type: Type.NUMBER },
                        feedback: { type: Type.STRING }
                      },
                      required: ["maxScore", "score", "feedback"]
                    }
                  }
                });

                const responseText = response.text || '';
                const cleanJson = responseText.replace(/```json|```/g, '').trim();
                const grading = JSON.parse(cleanJson || '{}');
                essayGrades[q.id] = grading;
                finalScore += Number(grading.score || 0);
                
                if (Number(grading.score || 0) === 0) {
                  incorrectQuestions.push(q.id);
                }
                graded = true; // Success
                
                // Add a small delay between successful requests to respect rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
              } catch (aiErr) {
                attempts++;
                console.error(`AI Grading failed for question ${q.id}, attempt ${attempts}`, aiErr);
                if (attempts >= 3) {
                  essayGrades[q.id] = { score: 0, feedback: "Lỗi khi chấm điểm tự động. Vui lòng báo giáo viên xem xét." };
                  incorrectQuestions.push(q.id);
                } else {
                  // Wait before retrying (rate limit etc)
                  await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
                }
              }
            }
          } else {
            essayGrades[q.id] = { score: 0, feedback: "Học sinh không nộp bài giải." };
            incorrectQuestions.push(q.id);
          }
        }
      }

      const submissionData = {
        examId: exam.id,
        studentId: appUser.uid,
        answers: JSON.stringify(answers),
        essayImages: JSON.stringify(essayImages),
        essayGrades: JSON.stringify(essayGrades),
        score: finalScore,
        status: essayQuestions.length > 0 ? 'graded' : 'graded',
        incorrectQuestions,
        submittedAt: new Date().toISOString()
      };

      const docRef = await addDoc(collection(db, 'submissions'), submissionData);
      
      const examRef = doc(db, 'exams', exam.id);
      await updateDoc(examRef, {
        submissionSummary: arrayUnion({
          submissionId: docRef.id,
          studentId: appUser.uid,
          studentName: appUser.name,
          score: finalScore,
          incorrectQuestions,
          submittedAt: submissionData.submittedAt
        })
      });

      setSubmittedResult({ score: finalScore, incorrectQuestions });
    } catch (err: any) {
      console.error("Submission error details:", err);
      
      let errorMsg = "Nộp bài thất bại. ";
      try {
        // Try to parse JSON error from handleFirestoreError if possible
        const parsed = JSON.parse(err.message);
        if (parsed.error) errorMsg += parsed.error;
      } catch (e) {
        errorMsg += err.message || "Vui lòng kiểm tra kết nối mạng và thử lại.";
      }
      
      setError(errorMsg);
      // Still call handleFirestoreError for logging benefits
      try {
        handleFirestoreError(err, OperationType.CREATE, 'submissions');
      } catch (logErr) {
        // Ignore secondary error from logger
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeypadClick = (val: string) => {
    if (!activeInputId) return;
    const currentVal = answers[activeInputId] || '';
    if (val === 'DEL') {
      handleAnswerChange(activeInputId, currentVal.slice(0, -1));
    } else if (val === 'CLEAR') {
      handleAnswerChange(activeInputId, '');
    } else {
      handleAnswerChange(activeInputId, currentVal + val);
    }
  };

  const handleEssayImageUpload = async (questionId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingEssayId(questionId);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1000;
          const MAX_HEIGHT = 1000;
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
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
          }
          const base64 = canvas.toDataURL('image/jpeg', 0.6);
          setEssayImages(prev => ({
            ...prev,
            [questionId]: [...(prev[questionId] || []), base64]
          }));
          setUploadingEssayId(null);
        };
      };
    } catch (err) {
      console.error("Essay image upload error:", err);
      alert("Lỗi khi tải ảnh.");
      setUploadingEssayId(null);
    }
  };

  const removeEssayImage = (questionId: string, imgIdx: number) => {
    setEssayImages(prev => ({
      ...prev,
      [questionId]: prev[questionId].filter((_, i) => i !== imgIdx)
    }));
  };

  if (error) {
    return (
      <div className="flex flex-col h-screen items-center justify-center bg-gray-50 px-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center border border-rose-100">
          <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Không thể tải đề thi</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/student')}
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-colors"
          >
            Quay lại danh sách
          </button>
        </div>
      </div>
    );
  }

  if (!exam) return <div className="flex h-screen items-center justify-center bg-gray-50 text-indigo-600 font-medium text-lg">Đang tải đề thi...</div>;

  if (submittedResult) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex flex-col items-center py-12 px-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-3xl w-full text-center animate-in fade-in zoom-in duration-500 border border-gray-100">
          <div className="w-24 h-24 bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg animate-pulse">
            <Clock className="w-12 h-12" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-indigo-900 mb-4">Nộp bài thành công!</h2>
          <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-8 text-left">
            <div className="flex items-center">
              <AlertCircle className="w-5 h-5 text-amber-400 mr-3" />
              <p className="text-amber-800 font-bold">
                Bài đang chờ Thầy Trọng chấm, quay lại sau 1 vài phút để xem kết quả.
              </p>
            </div>
          </div>
          <p className="text-gray-500 mb-8 font-medium">Bạn đã hoàn thành bài thi: <span className="font-bold text-gray-800 block mt-1">{exam.title}</span></p>
          
          <div className="flex flex-col space-y-4">
            <button
              onClick={() => navigate('/student')}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-2xl font-bold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5 text-lg"
            >
              Quay lại danh sách bài tập
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Sticky Header with Timer */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-lg border-b border-gray-200 px-4 py-3 sm:py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center">
          <button 
            onClick={() => setShowExitConfirm(true)}
            className="p-2.5 -ml-2 mr-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
            title="Quay lại"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <h1 className="text-lg sm:text-xl font-bold text-gray-800 truncate max-w-[150px] sm:max-w-md">{exam.title}</h1>
        </div>
        <div className={`flex items-center font-mono text-lg sm:text-2xl font-bold px-4 py-2 rounded-2xl shadow-sm border ${timeLeft !== null && timeLeft < 300 ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' : 'bg-indigo-50 text-indigo-700 border-indigo-100'}`}>
          <Clock className="w-5 h-5 sm:w-6 sm:h-6 mr-2" />
          {timeLeft !== null ? formatTime(timeLeft) : '--:--'}
        </div>
        <button
          onClick={() => setShowSubmitConfirm(true)}
          disabled={isSubmitting}
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 sm:px-8 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-bold hover:from-indigo-700 hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-500 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
        >
          {isSubmitting ? 'Đang chấm...' : 'Nộp bài'}
        </button>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="space-y-8">
          {exam.questions.map((q: any, index: number) => (
            <div key={q.id} className="bg-white shadow-sm border border-gray-200 sm:rounded-3xl p-6 md:p-8 transition-all hover:shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-start mb-8 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-5 shadow-sm">
                <span className="font-black text-lg mr-4 text-blue-700 whitespace-nowrap bg-white px-4 py-1.5 rounded-xl shadow-sm mb-3 sm:mb-0 border border-blue-100">Câu {index + 1}:</span>
                <div className="text-gray-800 text-lg leading-relaxed mt-1 sm:mt-0 flex-1 font-medium min-w-0 overflow-x-auto">
                  <MathText text={q.content} />
                </div>
              </div>
              
              {q.imageUrls && q.imageUrls.length > 0 && (
                <div className="mb-4 space-y-4">
                  {q.imageUrls.map((url: string, imgIdx: number) => (
                    <img key={imgIdx} src={url} alt={`Câu ${index + 1} - ảnh ${imgIdx + 1}`} className="max-w-full h-auto rounded-md" />
                  ))}
                </div>
              )}
              {/* Fallback for old data */}
              {q.imageUrl && (!q.imageUrls || q.imageUrls.length === 0) && (
                <div className="mb-4">
                  <img src={q.imageUrl} alt={`Câu ${index + 1}`} className="max-w-full h-auto rounded-md" />
                </div>
              )}

              {/* Multiple Choice */}
              {q.type === 'multiple_choice' && q.options && (
                <div className="space-y-3 mt-6">
                  {q.options.map((opt: string, i: number) => {
                    const letter = String.fromCharCode(65 + i);
                    const isSelected = answers[q.id] === letter;
                    let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                    if (!cleanOpt) cleanOpt = opt;
                    return (
                      <label key={i} className={`flex items-start p-4 border rounded-xl cursor-pointer transition-all duration-200 ${isSelected ? 'bg-indigo-50 border-indigo-500 ring-1 ring-indigo-500' : 'hover:bg-gray-50 border-gray-200'}`}>
                        <div className="flex items-center h-5 mt-0.5">
                          <input
                            type="radio"
                            name={`q-${q.id}`}
                            value={letter}
                            checked={isSelected}
                            onChange={() => handleAnswerChange(q.id, letter)}
                            className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                          />
                        </div>
                        <div className="ml-3 flex-1 flex items-start">
                          <span className="font-semibold text-gray-700 mr-2 mt-0.5">{letter}.</span>
                          <div className="text-gray-800 flex-1 min-w-0 overflow-x-auto"><MathText text={cleanOpt} /></div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* True / False */}
              {q.type === 'true_false' && q.options && (
                <div className="space-y-4 mt-6">
                  <p className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3">Chọn Đúng hoặc Sai cho mỗi phát biểu:</p>
                  <div className="space-y-3">
                    {q.options.map((opt: string, i: number) => {
                      const studentArr = answers[q.id] || [];
                      const currentVal = studentArr[i];
                      const letter = String.fromCharCode(97 + i);
                      let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                      if (!cleanOpt) cleanOpt = opt;
                      return (
                        <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 border border-gray-200 rounded-xl bg-gray-50/50 hover:bg-gray-50 transition-colors gap-4">
                          <div className="flex-1 flex items-start">
                            <span className="font-semibold text-gray-700 mr-3 mt-0.5">{letter}.</span>
                            <div className="text-gray-800 flex-1 min-w-0 overflow-x-auto"><MathText text={cleanOpt} /></div>
                          </div>
                          <div className="flex space-x-2 sm:flex-shrink-0">
                            <button
                              onClick={() => {
                                const newArr = [...studentArr];
                                newArr[i] = true;
                                handleAnswerChange(q.id, newArr);
                              }}
                              className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${currentVal === true ? 'bg-green-500 text-white shadow-sm ring-2 ring-green-500 ring-offset-1' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                            >
                              Đúng
                            </button>
                            <button
                              onClick={() => {
                                const newArr = [...studentArr];
                                newArr[i] = false;
                                handleAnswerChange(q.id, newArr);
                              }}
                              className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${currentVal === false ? 'bg-red-500 text-white shadow-sm ring-2 ring-red-500 ring-offset-1' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                            >
                              Sai
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Short Answer */}
              {q.type === 'short_answer' && (
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-3">Nhập đáp án của bạn:</label>
                  <input
                    type="text"
                    readOnly
                    value={answers[q.id] || ''}
                    onClick={() => setActiveInputId(q.id)}
                    placeholder="Nhấp vào đây để sử dụng bàn phím ảo..."
                    className={`block w-full sm:w-2/3 border rounded-xl shadow-sm py-4 px-5 text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all cursor-pointer ${activeInputId === q.id ? 'border-indigo-500 ring-2 ring-indigo-500 bg-indigo-50/50' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                  />
                </div>
              )}

              {/* Essay Upload */}
              {q.type === 'essay' && (
                <div className="mt-6 space-y-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2 flex items-center">
                    <BookOpen className="w-4 h-4 mr-2 text-indigo-600" />
                    Tải lên hình ảnh bài làm tự luận của bạn:
                  </label>
                  
                  <div className="flex flex-wrap gap-4 mb-4">
                    {essayImages[q.id]?.map((url, imgIdx) => (
                      <div key={imgIdx} className="relative group">
                        <img src={url} alt="Bài làm" className="w-32 h-32 object-cover rounded-xl border border-gray-200 shadow-sm" />
                        <button 
                          onClick={() => removeEssayImage(q.id, imgIdx)}
                          className="absolute -top-2 -right-2 bg-rose-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-rose-600 shadow-md transform scale-0 group-hover:scale-100 transition-transform"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    
                    <label className={`w-32 h-32 flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50 transition-all ${uploadingEssayId === q.id ? 'opacity-50 pointer-events-none' : ''}`}>
                      {uploadingEssayId === q.id ? (
                        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-gray-400 mb-1" />
                          <span className="text-xs text-gray-500 font-medium text-center px-2">Thêm ảnh bài làm</span>
                        </>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment"
                        className="hidden" 
                        onChange={(e) => handleEssayImageUpload(q.id, e)} 
                      />
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 italic">* Chụp ảnh rõ ràng để AI có thể nhận diện và chấm điểm chính xác nhất.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Custom Keypad for Short Answers */}
      {activeInputId && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-4 shadow-2xl z-50 animate-in slide-in-from-bottom-10">
          <div className="max-w-md mx-auto">
            <div className="flex justify-between items-center mb-2">
              <span className="text-white text-sm font-medium">Bàn phím nhập liệu</span>
              <button onClick={() => setActiveInputId(null)} className="text-gray-400 hover:text-white text-sm">Đóng</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {['7', '8', '9', '+'].map(k => (
                <button key={k} onClick={() => handleKeypadClick(k)} className="bg-gray-700 text-white text-xl font-medium py-3 rounded-md hover:bg-gray-600 active:bg-gray-500">{k}</button>
              ))}
              {['4', '5', '6', '-'].map(k => (
                <button key={k} onClick={() => handleKeypadClick(k)} className="bg-gray-700 text-white text-xl font-medium py-3 rounded-md hover:bg-gray-600 active:bg-gray-500">{k}</button>
              ))}
              {['1', '2', '3', ','].map(k => (
                <button key={k} onClick={() => handleKeypadClick(k)} className="bg-gray-700 text-white text-xl font-medium py-3 rounded-md hover:bg-gray-600 active:bg-gray-500">{k}</button>
              ))}
              <button onClick={() => handleKeypadClick('CLEAR')} className="bg-red-600 text-white text-sm font-medium py-3 rounded-md hover:bg-red-500 active:bg-red-400">Xóa hết</button>
              <button onClick={() => handleKeypadClick('0')} className="bg-gray-700 text-white text-xl font-medium py-3 rounded-md hover:bg-gray-600 active:bg-gray-500">0</button>
              <button onClick={() => handleKeypadClick('.')} className="bg-gray-700 text-white text-xl font-medium py-3 rounded-md hover:bg-gray-600 active:bg-gray-500">.</button>
              <button onClick={() => handleKeypadClick('DEL')} className="bg-yellow-600 text-white text-sm font-medium py-3 rounded-md hover:bg-yellow-500 active:bg-yellow-400">Xóa</button>
            </div>
          </div>
        </div>
      )}
      {/* Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-indigo-100 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-indigo-600" />
            </div>
            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">Xác nhận nộp bài</h3>
            <p className="text-center text-gray-600 mb-6">
              Bạn có chắc chắn muốn nộp bài thi này không? Sau khi nộp, bạn sẽ không thể thay đổi đáp án.
            </p>
            <div className="flex justify-center space-x-3">
              <button 
                onClick={() => setShowSubmitConfirm(false)} 
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                disabled={isSubmitting}
              >
                Quay lại làm bài
              </button>
              <button 
                onClick={() => {
                  setShowSubmitConfirm(false);
                  handleSubmit();
                }} 
                className="px-5 py-2.5 border border-transparent rounded-xl text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Đang nộp và chấm điểm AI...' : 'Đồng ý nộp bài'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">Xác nhận thoát</h3>
            <p className="text-center text-gray-600 mb-6">
              Bạn có chắc chắn muốn thoát khỏi bài thi này? Mọi kết quả làm bài hiện tại sẽ <strong>không được lưu lại</strong>.
            </p>
            <div className="flex justify-center space-x-3">
              <button 
                onClick={() => setShowExitConfirm(false)} 
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                Tiếp tục làm bài
              </button>
              <button 
                onClick={() => navigate('/student')} 
                className="px-5 py-2.5 border border-transparent rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
              >
                Thoát bài thi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
