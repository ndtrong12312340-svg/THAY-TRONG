import React, { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, getDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { ArrowLeft, Users, CheckCircle, XCircle, Trash2, AlertCircle, BarChart3, Loader2, RefreshCw, Eye, BookOpen, Brain } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from 'recharts';
import MathText from '../components/MathText';
import { GoogleGenAI, Type } from '@google/genai';
import { getAI } from '../services/ai';

export default function ExamResults() {
  const { examId } = useParams<{ examId: string }>();
  const { appUser } = useAuth();
  const [exam, setExam] = useState<any>(null);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [submissionToDelete, setSubmissionToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [regradingId, setRegradingId] = useState<string | null>(null);
  const [viewingDetailsId, setViewingDetailsId] = useState<string | null>(null);
  const [viewingSubmissionDetails, setViewingSubmissionDetails] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isGradingEssay, setIsGradingEssay] = useState<string | null>(null);

  const uniqueSubmissions = useMemo(() => {
    const map = new Map();
    console.log('Calculating unique submissions from:', submissions);
    submissions.forEach(sub => {
      // Use studentId as key. If a student submits multiple times, we only want the latest.
      // Is it possible studentId is not unique because of some data issue?
      if (!map.has(sub.studentId)) {
        map.set(sub.studentId, sub);
      } else {
        const existing = map.get(sub.studentId);
        const subDate = new Date(sub.submittedAt).getTime();
        const existingDate = new Date(existing.submittedAt).getTime();
        if (subDate > existingDate) {
          map.set(sub.studentId, sub);
        }
      }
    });
    const result = Array.from(map.values()).sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
    console.log('Unique submissions result:', result);
    return result;
  }, [submissions]);

  const fetchData = async () => {
    if (!examId) return;
    setIsRefreshing(true);
    try {
      const docRef = doc(db, 'exams', examId);
      const docSnap = await getDoc(docRef);
      let examData: any = null;
      if (docSnap.exists()) {
        examData = { id: docSnap.id, ...docSnap.data() };
        setExam(examData);
      }

      // Use submissionSummary from exam document instead of fetching all submissions
      // This saves N reads where N is the number of submissions
      if (examData && examData.submissionSummary) {
        const subs = examData.submissionSummary.map((s: any) => ({
          id: s.submissionId,
          studentId: s.studentId,
          score: s.score,
          incorrectQuestions: s.incorrectQuestions || [],
          submittedAt: s.submittedAt
        }));
        setSubmissions(subs);
      } else {
        setSubmissions([]);
      }

      const qStudents = query(collection(db, 'users'), where('role', '==', 'student'));
      const studentSnap = await getDocs(qStudents);
      const studs = studentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudents(studs);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, 'exam_results_data');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [examId]);

  if (!exam) return <div className="flex h-screen items-center justify-center">Đang tải...</div>;

  const getStudentName = (studentId: string) => {
    const student = students.find(s => s.uid === studentId);
    return student ? `${student.name} (${student.className})` : 'Học sinh không xác định';
  };

  const handleDeleteSubmission = async () => {
    if (!submissionToDelete || !exam) return;
    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'submissions', submissionToDelete));
      
      // Also remove from exam's submissionSummary
      if (exam.submissionSummary) {
        const updatedSummary = exam.submissionSummary.filter((s: any) => s.submissionId !== submissionToDelete);
        await updateDoc(doc(db, 'exams', exam.id), {
          submissionSummary: updatedSummary
        });
        setExam({ ...exam, submissionSummary: updatedSummary });
        setSubmissions(submissions.filter(s => s.id !== submissionToDelete));
      }
      
      setSubmissionToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `submissions/${submissionToDelete}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRegrade = async (submission: any) => {
    if (!exam) return;
    setRegradingId(submission.id);
    try {
      // Fetch the full submission document to get the answers
      const subDocRef = doc(db, 'submissions', submission.id);
      const subDoc = await getDoc(subDocRef);
      if (!subDoc.exists()) throw new Error('Không tìm thấy bài làm');
      const subData = subDoc.data();

      const answers = typeof subData.answers === 'string' ? JSON.parse(subData.answers || '{}') : subData.answers;
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
            const correctArr = JSON.parse(correctAnswer || '[]');
            const studentArr = studentAnswer || [];
            let correctParts = 0;
            for (let i = 0; i < 4; i++) {
              if (studentArr[i] === correctArr[i]) {
                correctParts++;
                score += 0.25; // 0.25 per correct part (a, b, c, or d)
              }
            }
            if (correctParts < 4) incorrectQuestions.push(q.id);
          } catch (e) {
            incorrectQuestions.push(q.id);
          }
        } else if (q.type === 'short_answer') {
          // Normalize both for comparison
          const sAns = String(studentAnswer || '').trim().toLowerCase().replace(/\s+/g, '');
          const cAns = String(correctAnswer || '').trim().toLowerCase().replace(/\s+/g, '');
          
          if (sAns === cAns && sAns !== '') {
            score += 0.5;
          } else {
            incorrectQuestions.push(q.id);
          }
        }
      });

      await updateDoc(doc(db, 'submissions', submission.id), {
        score,
        incorrectQuestions
      });

      // Also update the score in the exam's submissionSummary
      const updatedSummary = exam.submissionSummary.map((s: any) => {
        if (s.submissionId === submission.id) {
          return { ...s, score };
        }
        return s;
      });
      await updateDoc(doc(db, 'exams', exam.id), {
        submissionSummary: updatedSummary
      });
      
      // Update local state
      setExam({ ...exam, submissionSummary: updatedSummary });
      setSubmissions(submissions.map(s => s.id === submission.id ? { ...s, score } : s));

      alert('Đã chấm lại thành công!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `submissions/${submission.id}`);
    } finally {
      setRegradingId(null);
    }
  };

  const handleAIGradeEssay = async (submission: any, questionId: string) => {
    if (!exam || !submission) return;
    setIsGradingEssay(questionId);
    try {
      const q = exam.questions.find((q: any) => q.id === questionId);
      if (!q) throw new Error('Không tìm thấy câu hỏi');

      const essayImagesMap = typeof submission.essayImages === 'string' ? JSON.parse(submission.essayImages || '{}') : submission.essayImages;
      const images = essayImagesMap[questionId] || [];

      if (images.length === 0) {
        alert('Học sinh chưa tải lên ảnh bài làm.');
        return;
      }

      const ai = getAI();

      // Build prompt for AI grading
      const prompt = `
        Bạn là một giáo viên chấm thi chuyên nghiệp.
        Nhiệm vụ của bạn là chấm điểm bài làm tự luận của học sinh dựa trên ảnh chụp bài làm.

        CÂU HỎI:
        ${q.content}

        ĐÁP ÁN MẪU:
        ${q.correctAnswer || ""}

        LỜI GIẢI CHI TIẾT / HƯỚNG DẪN CHẤM:
        ${q.explanation || ""}

        HÃY PHÂN TÍCH ẢNH BÀI LÀM VÀ THỰC HIỆN:
        1. Chấm điểm bài làm trên thang điểm từ 0 đến 1.0. 
           QUAN TRỌNG: Hãy bám sát các bước trong LỜI GIẢI CHI TIẾT để chấm điểm thành phần nếu bài làm chưa hoàn thiện.
        2. Nhận xét chi tiết về bài làm (ưu điểm, lỗi sai, các bước thiếu).
        3. Nếu học sinh có cách giải khác nhưng vẫn đúng logic và kết quả, hãy vẫn cho điểm tối đa.

        Hãy trả về kết quả dưới dạng JSON:
        {
          "score": number, // Điểm số từ 0 đến 1.0 (Bước nhảy 0.25 hoặc 0.1)
          "feedback": string // Nhận xét chi tiết của giáo viên
        }
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            role: 'user',
            parts: [
              ...images.map((img: string) => ({
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: img.split(',')[1]
                }
              })),
              { text: prompt }
            ]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.NUMBER },
              feedback: { type: Type.STRING }
            },
            required: ["score", "feedback"]
          }
        }
      });

      const responseText = response.text || '';
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      const grading = JSON.parse(cleanJson || '{}');
      
      // Update submission with essay score
      // We need to be careful with existing total score
      const currentAnswers = typeof submission.answers === 'string' ? JSON.parse(submission.answers || '{}') : submission.answers;
      const oldEssayGrades = typeof submission.essayGrades === 'string' ? JSON.parse(submission.essayGrades || '{}') : (submission.essayGrades || {});
      const newEssayGrades = { ...oldEssayGrades, [questionId]: grading };

      // Re-calculate total score
      let totalMcScore = 0;
      exam.questions.forEach((eq: any) => {
        if (eq.type !== 'essay') {
          const ans = currentAnswers[eq.id];
          if (eq.type === 'multiple_choice' && ans === eq.correctAnswer) {
            totalMcScore += 0.25;
          } else if (eq.type === 'short_answer') {
            const sAns = String(ans || '').trim().toLowerCase().replace(/\s+/g, '');
            const cAns = String(eq.correctAnswer || '').trim().toLowerCase().replace(/\s+/g, '');
            if (sAns === cAns && sAns !== '') totalMcScore += 0.5;
          } else if (eq.type === 'true_false') {
            try {
              const cArr = JSON.parse(eq.correctAnswer || '[]');
              const sArr = ans || [];
              for (let i = 0; i < 4; i++) {
                if (sArr[i] === cArr[i]) totalMcScore += 0.25;
              }
            } catch(e) {}
          }
        }
      });

      const totalEssayScore = (Object.values(newEssayGrades) as any[]).reduce((acc: number, curr: any) => acc + Number(curr.score || 0), 0);
      const newTotalScore = totalMcScore + totalEssayScore;

      await updateDoc(doc(db, 'submissions', submission.id), {
        essayGrades: JSON.stringify(newEssayGrades),
        score: newTotalScore,
        status: 'graded'
      });

      // Update summary in exam
      const updatedSummary = exam.submissionSummary.map((s: any) => {
        if (s.submissionId === submission.id) {
          return { ...s, score: newTotalScore };
        }
        return s;
      });
      await updateDoc(doc(db, 'exams', exam.id), {
        submissionSummary: updatedSummary
      });

      // Update local state
      setViewingSubmissionDetails({ ...submission, essayGrades: JSON.stringify(newEssayGrades), score: newTotalScore });
      setExam({ ...exam, submissionSummary: updatedSummary });
      setSubmissions(submissions.map(s => s.id === submission.id ? { ...s, score: newTotalScore } : s));

      alert('Đã hoàn tất chấm điểm AI cho câu hỏi này!');
    } catch (error: any) {
      console.error("AI Grading Error:", error);
      alert('Lỗi khi chấm điểm AI: ' + error.message);
    } finally {
      setIsGradingEssay(null);
    }
  };

  const handleViewDetails = async (subId: string) => {
    setViewingDetailsId(subId);
    try {
      const subDoc = await getDoc(doc(db, 'submissions', subId));
      if (subDoc.exists()) {
        setViewingSubmissionDetails({ id: subDoc.id, ...subDoc.data() });
      }
    } catch (error) {
      console.error("Error fetching submission details:", error);
    }
  };

  const closeDetails = () => {
    setViewingDetailsId(null);
    setViewingSubmissionDetails(null);
  };

  const getScoreDistribution = () => {
    const bins: { name: string, count: number }[] = [];
    for (let i = 0; i <= 20; i++) {
      bins.push({ name: (i * 0.5).toFixed(1), count: 0 });
    }
    
    uniqueSubmissions.forEach(sub => {
      // Round to nearest 0.5
      const roundedScore = Math.round(sub.score * 2) / 2;
      const binIndex = Math.max(0, Math.min(20, roundedScore * 2));
      bins[binIndex].count++;
    });
    return bins;
  };

  const scoreData = getScoreDistribution();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-indigo-50/30 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-center justify-between bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex items-center">
            <Link to="/teacher" className="text-gray-400 hover:text-indigo-600 mr-6 transition-colors p-2 hover:bg-indigo-50 rounded-full">
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">Kết quả: {exam.title}</h1>
              <p className="text-sm font-medium text-gray-500 mt-1 flex items-center">
                <Users className="w-4 h-4 mr-1.5" />
                Số bài nộp: <span className="ml-1 text-indigo-600 font-bold">{uniqueSubmissions.length}</span>
              </p>
            </div>
          </div>
          <button
            onClick={fetchData}
            disabled={isRefreshing}
            className="flex items-center px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-semibold hover:bg-indigo-100 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-5 h-5 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Làm mới
          </button>
        </div>

        {uniqueSubmissions.length > 0 && (
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 mb-8">
            <h2 className="text-lg font-bold text-gray-800 mb-6 flex items-center">
              <span className="bg-indigo-100 text-indigo-600 p-2 rounded-lg mr-3">
                <BarChart3 className="w-5 h-5" />
              </span>
              Phổ điểm
            </h2>
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={scoreData}
                  margin={{ top: 20, right: 30, left: 0, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#6B7280', fontSize: 12 }}
                    dy={10}
                    label={{ value: 'Điểm số', position: 'insideBottom', offset: -15, fill: '#4B5563', fontSize: 14, fontWeight: 500 }}
                  />
                  <YAxis 
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#6B7280', fontSize: 12 }}
                    label={{ value: 'Số lượng', angle: -90, position: 'insideLeft', fill: '#4B5563', fontSize: 14, fontWeight: 500 }}
                  />
                  <Tooltip 
                    cursor={{ stroke: '#F3F4F6', strokeWidth: 2 }}
                    contentStyle={{ borderRadius: '0.75rem', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)' }}
                    formatter={(value: number) => [`${value} học sinh`, 'Số lượng']}
                    labelFormatter={(label) => `Điểm: ${label}`}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="count" 
                    stroke="#6366F1" 
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#6366F1', strokeWidth: 2, stroke: '#fff' }}
                    activeDot={{ r: 6, fill: '#4F46E5', strokeWidth: 0 }}
                  >
                    <LabelList dataKey="count" position="top" fill="#4F46E5" fontSize={12} fontWeight={600} formatter={(val: number) => val > 0 ? val : ''} offset={10} />
                  </Line>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
          <ul className="divide-y divide-gray-100">
            {uniqueSubmissions.length === 0 ? (
              <li className="px-8 py-12 text-center text-gray-500 font-medium flex flex-col items-center justify-center">
                <div className="bg-gray-50 p-4 rounded-full mb-3">
                  <Users className="w-8 h-8 text-gray-400" />
                </div>
                Chưa có học sinh nào nộp bài.
              </li>
            ) : uniqueSubmissions.map((sub) => (
              <li key={sub.id} className="px-6 py-6 hover:bg-gray-50/50 transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center mb-4 sm:mb-0">
                    <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-full flex items-center justify-center border border-indigo-200 shadow-sm">
                      <Users className="h-6 w-6 text-indigo-600" />
                    </div>
                    <div className="ml-5">
                      <h3 className="text-lg font-bold text-gray-900">{getStudentName(sub.studentId)}</h3>
                      <p className="text-sm font-medium text-gray-500 mt-0.5">
                        Nộp lúc: {new Date(sub.submittedAt).toLocaleString('vi-VN')}
                      </p>
                    </div>
                  </div>
                  <div className="text-left sm:text-right flex flex-col sm:items-end">
                    <div className="flex items-center justify-between sm:justify-end w-full">
                      <div className="bg-indigo-50 px-4 py-2 rounded-xl border border-indigo-100 mr-4">
                        <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600">{sub.score.toFixed(2)} <span className="text-base text-indigo-300 font-bold">/ 10</span></p>
                      </div>
                      <button
                        onClick={() => handleRegrade(sub)}
                        disabled={regradingId === sub.id}
                        className="text-indigo-400 hover:text-indigo-600 p-2.5 rounded-xl hover:bg-indigo-50 transition-colors border border-transparent hover:border-indigo-100 mr-2 disabled:opacity-50"
                        title="Chấm lại bài này"
                      >
                        {regradingId === sub.id ? <Loader2 className="w-5 h-5 animate-spin" /> : <RefreshCw className="w-5 h-5" />}
                      </button>
                      <button
                        onClick={() => setSubmissionToDelete(sub.id)}
                        className="text-red-400 hover:text-red-600 p-2.5 rounded-xl hover:bg-red-50 transition-colors border border-transparent hover:border-red-100"
                        title="Xóa kết quả để học sinh làm lại"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    {sub.incorrectQuestions && sub.incorrectQuestions.length > 0 ? (
                      <div className="text-sm text-rose-600 flex items-center justify-between sm:justify-end mt-3 bg-rose-50/50 px-3 py-2 rounded-lg border border-rose-100 w-full sm:w-auto">
                        <div className="flex items-center font-bold mr-4">
                          <XCircle className="w-4 h-4 mr-1.5" />
                          {sub.incorrectQuestions.length} câu sai
                        </div>
                        <button
                          onClick={() => handleViewDetails(sub.id)}
                          className="flex items-center text-xs font-bold bg-white border border-rose-200 text-rose-600 px-3 py-1.5 rounded-md hover:bg-rose-50 transition-colors shadow-sm"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1.5" />
                          Xem chi tiết
                        </button>
                      </div>
                    ) : (
                      <div className="text-sm text-emerald-600 flex items-center sm:justify-end mt-3 bg-emerald-50/50 px-3 py-2 rounded-lg border border-emerald-100 font-bold">
                        <CheckCircle className="w-4 h-4 mr-1.5" />
                        Hoàn hảo! Không sai câu nào.
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Delete Submission Confirmation Modal */}
      {submissionToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-xl font-bold text-center text-gray-900 mb-2">Xác nhận xóa kết quả</h3>
            <p className="text-center text-gray-600 mb-6">
              Bạn có chắc chắn muốn xóa kết quả bài làm này? Sau khi xóa, học sinh sẽ có thể làm lại bài thi. Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-center space-x-3">
              <button 
                onClick={() => setSubmissionToDelete(null)} 
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                disabled={isDeleting}
              >
                Hủy
              </button>
              <button 
                onClick={handleDeleteSubmission} 
                className="px-5 py-2.5 border border-transparent rounded-xl text-sm font-medium text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
                disabled={isDeleting}
              >
                {isDeleting ? 'Đang xóa...' : 'Đồng ý xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Details Modal */}
      {viewingDetailsId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900 flex items-center">
                <XCircle className="w-6 h-6 text-rose-500 mr-2" />
                Chi tiết các câu trả lời sai
              </h3>
              <button 
                onClick={closeDetails}
                className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1 bg-gray-50/30">
              {(() => {
                const sub = viewingSubmissionDetails;
                if (!sub || !exam || !exam.questions) {
                  return <div className="flex justify-center items-center h-32"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>;
                }
                
                // Group incorrect questions and essay questions
                const essayQuestions = exam.questions.filter((q: any) => q.type === 'essay');
                const incorrectIds = sub.incorrectQuestions || [];
                const questionsToShow = Array.from(new Set([...incorrectIds, ...essayQuestions.map((q: any) => q.id)]));
                
                return (
                  <div className="space-y-6">
                    <div className="bg-amber-100 p-4 rounded-xl text-amber-800 font-bold flex items-center mb-4">
                      {sub.status === 'graded' ? (
                        <><CheckCircle className="w-5 h-5 mr-2 text-emerald-600" /> Trạng thái: Đã chấm điểm</>
                      ) : (
                        <><AlertCircle className="w-5 h-5 mr-2 text-amber-600" /> Trạng thái: Chờ chấm bài (Tự luận)</>
                      )}
                    </div>

                    {questionsToShow.map((qId: string) => {
                      const qIndex = exam.questions.findIndex((q: any) => String(q.id) === String(qId));
                      const q = exam.questions[qIndex];
                      
                      if (!q) return null;
                      
                      const isEssay = q.type === 'essay';
                      
                      let studentAns: any = '';
                      try {
                        const parsedAnswers = typeof sub.answers === 'string' ? JSON.parse(sub.answers) : sub.answers;
                        studentAns = parsedAnswers[qId];
                      } catch (e) {}

                      const essayImagesMap = typeof sub.essayImages === 'string' ? JSON.parse(sub.essayImages || '{}') : sub.essayImages;
                      const images = essayImagesMap[qId] || [];

                      const essayGradesMap = typeof sub.essayGrades === 'string' ? JSON.parse(sub.essayGrades || '{}') : (sub.essayGrades || {});
                      const grade = essayGradesMap[qId];
                      
                      return (
                        <div key={qId} className={`bg-white p-5 rounded-xl border ${isEssay ? 'border-indigo-100' : 'border-rose-100'} shadow-sm`}>
                          <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-100">
                            <div className={`font-bold text-lg ${isEssay ? 'text-indigo-700' : 'text-rose-700'}`}>
                              Câu {qIndex !== -1 ? qIndex + 1 : '?'} ({isEssay ? 'Tự luận' : 'Câu sai'})
                            </div>
                            {isEssay && (
                              <button
                                onClick={() => handleAIGradeEssay(sub, q.id)}
                                disabled={isGradingEssay === q.id || images.length === 0}
                                className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 shadow-sm"
                              >
                                {isGradingEssay === q.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Brain className="w-4 h-4 mr-2" />}
                                AI Chấm điểm
                              </button>
                            )}
                          </div>
                          
                          <div className="mb-4 text-gray-700 bg-gray-50 p-4 rounded-lg border border-gray-100">
                            <MathText text={q.content} />
                            
                            {isEssay && images.length > 0 && (
                              <div className="mt-4 flex flex-wrap gap-3">
                                {images.map((img: string, idx: number) => (
                                  <a key={idx} href={img} target="_blank" rel="noopener noreferrer">
                                    <img src={img} alt="Bài làm học sinh" className="max-h-48 rounded border border-gray-300 hover:opacity-90 transition-opacity" />
                                  </a>
                                ))}
                              </div>
                            )}

                            {!isEssay && Array.isArray(q.options) && q.options.length > 0 && (
                              <div className="mt-4 space-y-2">
                                {q.options.map((opt: string, i: number) => {
                                  const letter = q.type === 'true_false' ? String.fromCharCode(97 + i) : String.fromCharCode(65 + i);
                                  return (
                                    <div key={i} className="flex items-start text-sm">
                                      <span className="font-semibold mr-2">{letter}.</span>
                                      <MathText text={opt} />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                          
                          {isEssay ? (
                            <div className="space-y-4">
                              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                                <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Đáp án mẫu / Hướng dẫn chấm</div>
                                <div className="text-emerald-800 font-medium whitespace-pre-wrap"><MathText text={q.correctAnswer || q.explanation || ''} /></div>
                              </div>
                              
                              {grade ? (
                                <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
                                  <div className="flex justify-between items-center mb-2">
                                    <div className="text-sm font-bold text-indigo-700 uppercase">Kết quả chấm điểm AI</div>
                                    <div className="text-2xl font-black text-indigo-600">{grade.score} <span className="text-sm font-bold">điểm</span></div>
                                  </div>
                                  <div className="text-gray-700 text-sm whitespace-pre-wrap italic">"{grade.feedback}"</div>
                                </div>
                              ) : (
                                <div className="bg-gray-100 p-4 rounded-xl text-center text-gray-500 text-sm italic">
                                  Chưa chấm điểm cho câu này. Hãy nhấn nút "AI Chấm điểm" ở trên.
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="bg-rose-50 p-3 rounded-lg border border-rose-100">
                                <div className="text-xs font-bold text-rose-500 uppercase tracking-wider mb-1">Học sinh chọn</div>
                                <div className="font-medium text-rose-700">{(() => {
                                  if (q.type === 'true_false') {
                                    try {
                                      const sArr = Array.isArray(studentAns) ? studentAns : [];
                                      return sArr.map((v: any) => v === true ? 'Đúng' : v === false ? 'Sai' : 'Trống').join(' | ');
                                    } catch(e) { return '(Trống)'; }
                                  }
                                  return String(studentAns || '(Trống)');
                                })()}</div>
                              </div>
                              <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-100">
                                <div className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">Đáp án đúng</div>
                                <div className="font-medium text-emerald-700">{(() => {
                                  if (q.type === 'true_false') {
                                    try {
                                      const cArr = typeof q.correctAnswer === 'string' ? JSON.parse(q.correctAnswer || '[]') : (q.correctAnswer || []);
                                      return cArr.map((v: any) => v === true ? 'Đúng' : v === false ? 'Sai' : 'Trống').join(' | ');
                                    } catch(e) { return '(Trống)'; }
                                  }
                                  return String(q.correctAnswer || '(Trống)');
                                })()}</div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button 
                onClick={closeDetails}
                className="px-6 py-2.5 bg-white border border-gray-300 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
