import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { CheckCircle, AlertCircle, BookOpen } from 'lucide-react';
import MathText from '../components/MathText';

export default function StudentExamResult() {
  const { examId, studentId } = useParams<{ examId: string, studentId?: string }>();
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const [exam, setExam] = useState<any>(null);
  const [submission, setSubmission] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!examId || !appUser) return;
      try {
        const examDoc = await getDoc(doc(db, 'exams', examId));
        if (examDoc.exists()) {
          setExam({ id: examDoc.id, ...examDoc.data() });
        }

        const targetStudentId = studentId || appUser.uid;
        const q = query(
          collection(db, 'submissions'),
          where('examId', '==', examId),
          where('studentId', '==', targetStudentId)
        );
        const subSnap = await getDocs(q);
        if (!subSnap.empty) {
          setSubmission({ id: subSnap.docs[0].id, ...subSnap.docs[0].data() });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, 'exam_result');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [examId, appUser]);

  if (loading) return <div className="flex h-screen items-center justify-center bg-gray-50 text-indigo-600 font-medium text-lg">Đang tải kết quả...</div>;
  if (!exam || !submission) return <div className="flex h-screen items-center justify-center bg-gray-50 text-red-500 font-medium text-lg">Không tìm thấy kết quả.</div>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50 flex flex-col items-center py-12 px-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-3xl w-full text-center animate-in fade-in zoom-in duration-500 border border-gray-100">
        <div className="w-24 h-24 bg-gradient-to-br from-emerald-400 to-teal-500 text-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg transform hover:scale-105 transition-transform">
          <CheckCircle className="w-12 h-12" />
        </div>
        <h2 className="text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-emerald-600 to-teal-600 mb-2">Kết quả bài thi</h2>
        <p className="text-gray-500 mb-8 font-medium"><span className="font-bold text-gray-800 block mt-1">{exam.title}</span></p>
        
        <div className="bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 rounded-2xl p-8 mb-8 shadow-inner">
          <div className="text-sm font-bold text-gray-400 mb-3 uppercase tracking-widest">Điểm của bạn</div>
          <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 mb-2 drop-shadow-sm">
            {submission.score.toFixed(2)}<span className="text-3xl text-gray-300 font-bold">/10</span>
          </div>
          
          {submission.incorrectQuestions && submission.incorrectQuestions.length > 0 ? (
            <div className="mt-8 text-sm text-rose-600 bg-rose-50/80 border border-rose-100 p-5 rounded-xl text-left shadow-sm">
              <span className="font-bold block mb-2 flex items-center"><AlertCircle className="w-4 h-4 mr-1.5"/> Sai các câu:</span> 
              <div className="flex flex-col gap-2">
                {submission.incorrectQuestions.map((id: string) => {
                  const idx = exam.questions.findIndex((q:any) => q.id === id);
                  const q = exam.questions[idx];
                  if (!q) return null;
                  
                  let studentAns: any = '';
                  try {
                    const parsedAnswers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : submission.answers;
                    studentAns = parsedAnswers[id];
                  } catch (e) {}
                  
                  let displayStudentAns = String(studentAns || '(Trống)');
                  let displayCorrectAns = String(q.correctAnswer || '(Trống)');
                  
                  if (q.type === 'true_false') {
                    try {
                      const sArr = Array.isArray(studentAns) ? studentAns : [];
                      const cArr = typeof q.correctAnswer === 'string' ? JSON.parse(q.correctAnswer || '[]') : (q.correctAnswer || []);
                      displayStudentAns = sArr.map((v: any) => v === true ? 'Đ' : v === false ? 'S' : '-').join('');
                      displayCorrectAns = cArr.map((v: any) => v === true ? 'Đ' : v === false ? 'S' : '-').join('');
                      if (!displayStudentAns) displayStudentAns = '(Trống)';
                    } catch(e) {}
                  }
                  
                  return (
                    <div key={id} className="bg-white px-3 py-2 rounded-md shadow-sm border border-rose-100">
                      <span className="font-bold">Câu {idx !== -1 ? idx + 1 : '?'}:</span> Bạn chọn <span className="line-through text-rose-400 font-semibold">{displayStudentAns}</span> <span className="text-emerald-600 font-bold ml-1">(Đáp án: {displayCorrectAns})</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-8 text-sm text-emerald-700 bg-emerald-50/80 border border-emerald-100 p-5 rounded-xl font-bold shadow-sm flex items-center justify-center">
              <CheckCircle className="w-5 h-5 mr-2"/> Hoàn hảo! Bạn không sai câu nào.
            </div>
          )}
        </div>

        <div className="mb-8 text-left">
          <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-indigo-600" />
            Chi tiết bài làm và Lời giải
          </h3>
          <div className="space-y-6">
            {exam.questions.map((question: any, idx: number) => {
              const id = question.id;

              const isQuestionIncorrect = submission.incorrectQuestions?.includes(id);

                const essayGradesMap = typeof submission.essayGrades === 'string' ? JSON.parse(submission.essayGrades || '{}') : (submission.essayGrades || {});
                const essayGrade = essayGradesMap[id];
                const isEssay = question.type === 'essay';

                return (
                  <div key={id} className={`bg-white border ${isQuestionIncorrect ? 'border-rose-200' : 'border-emerald-200'} rounded-2xl p-6 shadow-sm`}>
                    <div className={`font-bold text-lg mb-3 flex items-center ${isQuestionIncorrect ? 'text-rose-700' : 'text-emerald-700'}`}>
                      Câu {idx + 1}
                      {isEssay ? (
                        <>
                          <span className={`ml-2 inline-flex items-center text-sm ${essayGrade ? (essayGrade.score > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700') : 'bg-amber-100 text-amber-700'} px-2.5 py-0.5 rounded-full`}>
                            {essayGrade ? (essayGrade.score > 0 ? <CheckCircle className="w-4 h-4 mr-1"/> : <AlertCircle className="w-4 h-4 mr-1"/>) : <AlertCircle className="w-4 h-4 mr-1"/>}
                            Tự luận: {essayGrade ? `${essayGrade.score}đ` : 'Chưa chấm'}
                          </span>
                        </>
                      ) : !isQuestionIncorrect ? (
                        <span className="ml-2 inline-flex items-center text-sm bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full"><CheckCircle className="w-4 h-4 mr-1"/> Đúng</span>
                      ) : (
                        <span className="ml-2 inline-flex items-center text-sm bg-rose-100 text-rose-700 px-2.5 py-0.5 rounded-full"><AlertCircle className="w-4 h-4 mr-1"/> Sai</span>
                      )}
                    </div>
                    <div className="text-gray-800 mb-4 font-medium min-w-0 overflow-x-auto">
                      <MathText text={question.content} />
                    </div>
                    
                    {question.type === 'multiple_choice' && question.options && (
                      <div className="space-y-3 mt-4 mb-6">
                        {question.options.map((opt: string, i: number) => {
                          const letter = String.fromCharCode(65 + i);
                          let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                          if (!cleanOpt) cleanOpt = opt;
                          
                          const isCorrect = question.correctAnswer === letter;
                          let studentAns = '';
                          try {
                            const parsedAnswers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : submission.answers;
                            studentAns = parsedAnswers[id];
                          } catch (e) {}
                          const isStudentChoice = studentAns === letter;
                          
                          return (
                            <div key={i} className={`flex items-start p-3 border rounded-xl ${isCorrect ? 'bg-emerald-50 border-emerald-200' : isStudentChoice ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex-1 flex items-start">
                                <span className={`font-semibold mr-2 mt-0.5 ${isCorrect ? 'text-emerald-700' : isStudentChoice ? 'text-rose-700' : 'text-gray-700'}`}>{letter}.</span>
                                <div className={`flex-1 min-w-0 overflow-x-auto ${isCorrect ? 'text-emerald-800 font-medium' : isStudentChoice ? 'text-rose-800 font-medium' : 'text-gray-800'}`}><MathText text={cleanOpt} /></div>
                              </div>
                              {isCorrect && <CheckCircle className="w-5 h-5 text-emerald-500 ml-2 flex-shrink-0" />}
                              {isStudentChoice && !isCorrect && <AlertCircle className="w-5 h-5 text-rose-500 ml-2 flex-shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {question.type === 'true_false' && question.options && (
                      <div className="space-y-3 mt-4 mb-6">
                        {question.options.map((opt: string, i: number) => {
                          const letter = String.fromCharCode(97 + i);
                          let cleanOpt = opt.replace(new RegExp(`^${letter}[\\.\\:\\)]\\s*|^${letter}\\s+`, 'i'), '').trim();
                          if (!cleanOpt) cleanOpt = opt;
                          
                          let correctVal = null;
                          let studentVal = null;
                          try {
                            const cArr = typeof question.correctAnswer === 'string' ? JSON.parse(question.correctAnswer || '[]') : (question.correctAnswer || []);
                            correctVal = cArr[i];
                            const parsedAnswers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : submission.answers;
                            const sArr = Array.isArray(parsedAnswers[id]) ? parsedAnswers[id] : [];
                            studentVal = sArr[i];
                          } catch(e) {}
                          
                          const isCorrect = studentVal === correctVal;
                          
                          return (
                            <div key={i} className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-xl gap-4 ${studentVal !== undefined && studentVal !== null && !isCorrect ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex-1 flex items-start">
                                <span className="font-semibold text-gray-700 mr-3 mt-0.5">{letter}.</span>
                                <div className="text-gray-800 flex-1 min-w-0 overflow-x-auto"><MathText text={cleanOpt} /></div>
                              </div>
                              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                                {studentVal !== undefined && studentVal !== null && (
                                  <div className={`flex-shrink-0 text-sm px-2 py-1 rounded border ${isCorrect ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200'}`}>
                                    Bạn chọn: {studentVal === true ? 'Đúng' : 'Sai'}
                                  </div>
                                )}
                                <div className="flex-shrink-0 font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-100">
                                  Đáp án: {correctVal === true ? 'Đúng' : correctVal === false ? 'Sai' : 'Chưa có'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {question.type === 'short_answer' && (
                      <div className="mt-4 mb-6 p-4 border rounded-xl bg-gray-50 border-gray-200">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center">
                            <span className="font-semibold text-gray-700 mr-2">Bạn đã nhập:</span>
                            {(() => {
                                let studentAns = '';
                                try {
                                  const parsedAnswers = typeof submission.answers === 'string' ? JSON.parse(submission.answers) : submission.answers;
                                  studentAns = parsedAnswers[id] || '';
                                } catch (e) {}
                                const isCorrect = studentAns.trim() === (question.correctAnswer || '').trim();
                                return (
                                  <span className={`font-bold px-3 py-1 rounded-lg border ${isCorrect ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                    {studentAns || '(Trống)'}
                                  </span>
                                );
                            })()}
                          </div>
                          <div className="flex items-center">
                            <span className="font-semibold text-gray-700 mr-2">Đáp án đúng:</span>
                            <span className="font-bold px-3 py-1 rounded-lg border bg-emerald-50 text-emerald-700 border-emerald-200">
                              {question.correctAnswer || '(Chưa có)'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {question.type === 'essay' && (
                      <div className="mt-4 mb-6 space-y-4">
                        <div className="p-4 border rounded-xl bg-indigo-50 border-indigo-200">
                          <div className="font-bold text-indigo-800 mb-2">Bài giải của bạn:</div>
                          <div className="flex flex-wrap gap-3">
                            {(() => {
                              const essayImagesMap = typeof submission.essayImages === 'string' ? JSON.parse(submission.essayImages || '{}') : submission.essayImages;
                              const images = essayImagesMap?.[id] || [];
                              return images.length > 0 ? images.map((url: string, imgIdx: number) => (
                                <img key={imgIdx} src={url} alt={`Bài giải - ảnh ${imgIdx + 1}`} className="max-h-64 rounded-lg shadow-sm border border-gray-200" />
                              )) : <div className="text-gray-500 italic">Bạn không tải lên bài giải ảnh.</div>;
                            })()}
                          </div>
                        </div>
                        
                        {(() => {
                          const essayGradesMap = typeof submission.essayGrades === 'string' ? JSON.parse(submission.essayGrades || '{}') : (submission.essayGrades || {});
                          const grade = essayGradesMap[id];
                          if (grade) {
                            return (
                              <div className="bg-indigo-600 p-5 rounded-2xl text-white shadow-md">
                                <div className="flex justify-between items-center mb-3">
                                  <div className="text-sm font-bold uppercase tracking-wider opacity-80">Kết quả chấm điểm AI</div>
                                  <div className="text-3xl font-black">{grade.score} <span className="text-base font-bold opacity-80">điểm</span></div>
                                </div>
                                <div className="text-sm leading-relaxed italic bg-white/10 p-3 rounded-xl border border-white/20">"{grade.feedback}"</div>
                              </div>
                            );
                          } else {
                            return (
                              <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl text-amber-800 text-sm font-medium flex items-center">
                                <AlertCircle className="w-5 h-5 mr-2" />
                                Phần tự luận này đang chờ giáo viên chấm bài.
                              </div>
                            );
                          }
                        })()}

                        <div className="p-4 border rounded-xl bg-emerald-50 border-emerald-200">
                          <div className="font-bold text-emerald-800 mb-2">Đáp án mẫu / Hướng dẫn chấm:</div>
                          <div className="text-gray-800 min-w-0 overflow-x-auto">
                            <MathText text={question.correctAnswer || '(Chưa có)'} />
                          </div>
                        </div>
                      </div>
                    )}

                    {question.imageUrls && question.imageUrls.length > 0 && (
                      <div className="mb-4 space-y-4">
                        {question.imageUrls.map((url: string, imgIdx: number) => (
                          <img key={imgIdx} src={url} alt={`Câu ${idx + 1} - ảnh ${imgIdx + 1}`} className="max-w-full h-auto rounded-md border border-gray-200" />
                        ))}
                      </div>
                    )}
                    {question.imageUrl && (!question.imageUrls || question.imageUrls.length === 0) && (
                      <div className="mb-4">
                        <img src={question.imageUrl} alt={`Câu ${idx + 1}`} className="max-w-full h-auto rounded-md border border-gray-200" />
                      </div>
                    )}

                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 mt-4">
                      <div className="font-semibold text-indigo-800 mb-2">Lời giải:</div>
                      <div className="text-gray-700 min-w-0 overflow-x-auto">
                        {question.explanation ? (
                          <MathText text={question.explanation} />
                        ) : (
                          <span className="italic text-gray-500">Giáo viên chưa cung cấp lời giải cho câu hỏi này.</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
            })}
          </div>
        </div>

        <button
          onClick={() => {
            if (appUser?.role === 'teacher') {
              navigate('/teacher');
            } else {
              navigate('/student');
            }
          }}
          className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-4 rounded-2xl font-bold hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5 text-lg"
        >
          {appUser?.role === 'teacher' ? 'Quay lại bảng điều khiển' : 'Quay lại danh sách bài tập'}
        </button>
      </div>
    </div>
  );
}
