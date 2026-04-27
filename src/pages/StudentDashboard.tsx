import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, doc, updateDoc } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { LogOut, PlayCircle, CheckCircle, XCircle, RefreshCw, MessageCircle, X, AlertCircle } from 'lucide-react';

export default function StudentDashboard() {
  const { appUser, logout } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showFbModal, setShowFbModal] = useState(false);
  const [fbLink, setFbLink] = useState(appUser?.facebook || '');
  const [isUpdatingFb, setIsUpdatingFb] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdateFacebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appUser?.uid) return;
    setIsUpdatingFb(true);
    try {
      await updateDoc(doc(db, 'users', appUser.uid), {
        facebook: fbLink
      });
      setShowFbModal(false);
      alert('Cập nhật Facebook thành công! Vui lòng đăng xuất và đăng nhập lại để thấy thay đổi.');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${appUser.uid}`);
    } finally {
      setIsUpdatingFb(false);
    }
  };

  const fetchData = async () => {
    if (!appUser?.uid || !appUser?.className) return;
    setIsRefreshing(true);
    setError(null);
    try {
      // Fetch published exams assigned to student's class
      const qExams = query(
        collection(db, 'exams'),
        where('status', '==', 'published'),
        where('assignedClasses', 'array-contains', appUser.className)
      );
      
      const examSnap = await getDocs(qExams);
      const examsList = examSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // Sort exams by number in title
      examsList.sort((a: any, b: any) => {
        const titleA = a.title || '';
        const titleB = b.title || '';
        
        const matchA = titleA.match(/\d+/);
        const matchB = titleB.match(/\d+/);
        
        if (matchA && matchB) {
          const numA = parseInt(matchA[0], 10);
          const numB = parseInt(matchB[0], 10);
          if (numA !== numB) {
            return numA - numB;
          }
        }
        
        return titleA.localeCompare(titleB);
      });
      
      setExams(examsList);

      // SMART FETCH: We no longer need to fetch submissions at all!
      // The exam document now contains a submissionSummary array.
      // We can just check if the student's ID is in that array.
      const activeSubmissions: any[] = [];
      examsList.forEach((exam: any) => {
        if (exam.submissionSummary) {
          const studentSub = exam.submissionSummary.find((s: any) => s.studentId === appUser.uid);
          if (studentSub) {
            activeSubmissions.push({
              examId: exam.id,
              ...studentSub
            });
          }
        }
      });
      
      setSubmissions(activeSubmissions);
    } catch (err: any) {
      console.error("Error fetching data:", err);
      if (err.message && err.message.includes('Quota')) {
        setError('Hệ thống đang quá tải (vượt quá giới hạn truy cập miễn phí của Firebase). Vui lòng thử lại sau.');
      } else {
        setError('Đã xảy ra lỗi khi tải danh sách bài tập. Vui lòng thử lại.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [appUser?.uid, appUser?.className]);

  const getSubmission = (examId: string) => {
    return submissions.find(s => s.examId === examId);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-white tracking-wide">Học sinh: {appUser?.name} <span className="font-normal opacity-80">({appUser?.className})</span></h1>
            </div>
            <div className="flex items-center space-x-4">
              {!appUser?.facebook && (
                <button onClick={() => setShowFbModal(true)} className="text-blue-100 hover:text-white flex items-center transition-colors font-medium mr-2">
                  <MessageCircle className="w-5 h-5 mr-1" /> Cập nhật Facebook
                </button>
              )}
              <button onClick={fetchData} disabled={isRefreshing} className="text-blue-100 hover:text-white flex items-center transition-colors font-medium mr-2">
                <RefreshCw className={`w-5 h-5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} /> Làm mới
              </button>
              <button onClick={logout} className="text-blue-100 hover:text-white flex items-center transition-colors font-medium">
                <LogOut className="w-5 h-5 mr-1" /> Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Update Facebook Modal */}
      {showFbModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl transform transition-all">
            <div className="flex justify-between items-center mb-5">
              <h3 className="text-xl font-bold text-gray-900">Cập nhật Link Facebook</h3>
              <button onClick={() => setShowFbModal(false)} className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Để giảm tải dung lượng máy chủ và tối ưu hóa tốc độ hệ thống, vui lòng cập nhật đường link Facebook cá nhân của bạn.
            </p>
            <form onSubmit={handleUpdateFacebook}>
              <div>
                <label className="block text-sm font-medium text-gray-700">Đường link Facebook</label>
                <input 
                  type="url" 
                  value={fbLink} 
                  onChange={e => setFbLink(e.target.value)} 
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm" 
                  placeholder="https://facebook.com/..." 
                  required
                />
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button type="button" onClick={() => setShowFbModal(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  Hủy
                </button>
                <button type="submit" disabled={isUpdatingFb} className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
                  {isUpdatingFb ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h2 className="text-2xl font-bold text-gray-800 mb-6">Đề thi của bạn</h2>
        
        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start">
            <AlertCircle className="w-5 h-5 text-rose-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-rose-700 font-medium">{error}</div>
          </div>
        )}

        <div className="bg-white shadow-md overflow-hidden sm:rounded-2xl border border-gray-100">
          <ul className="divide-y divide-gray-100">
            {exams.length === 0 && !isRefreshing && !error ? (
              <li className="px-6 py-12 text-center text-gray-500">
                <CheckCircle className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                <p className="text-lg font-medium">Chưa có đề thi nào được giao.</p>
                <p className="text-sm mt-1">Hãy quay lại sau nhé!</p>
              </li>
            ) : exams.map((exam) => {
              const sub = getSubmission(exam.id);
              const now = new Date().getTime();
              const startTime = exam.startTime ? new Date(exam.startTime).getTime() : null;
              const endTime = exam.endTime ? new Date(exam.endTime).getTime() : null;
              
              const isBeforeStart = startTime && now < startTime;
              const isAfterEnd = endTime && now > endTime;
              
              return (
                <li key={exam.id} className="hover:bg-blue-50/50 transition-colors duration-150">
                  <div className="px-6 py-5 sm:flex sm:justify-between sm:items-center">
                    <div className="mb-4 sm:mb-0">
                      <h3 className="text-lg font-bold text-gray-900 truncate mb-1">{exam.title}</h3>
                      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                        <span className="flex items-center bg-gray-100 px-2.5 py-1 rounded-md font-medium">
                          Thời gian làm bài: {exam.duration} phút
                        </span>
                      </div>
                      {(exam.startTime || exam.endTime) && (
                        <p className="mt-2 text-sm text-gray-600">
                          <span className="font-medium mr-1">Mở:</span> {exam.startTime ? new Date(exam.startTime).toLocaleString('vi-VN') : 'Không giới hạn'} - {exam.endTime ? new Date(exam.endTime).toLocaleString('vi-VN') : 'Không giới hạn'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-4">
                      {sub ? (
                        <div className="flex flex-col items-end">
                          <div className="flex items-center text-emerald-600 font-semibold text-sm mb-2 bg-emerald-50 px-3 py-1 rounded-full">
                            <CheckCircle className="w-4 h-4 mr-1.5" />
                            Đã hoàn thành
                          </div>
                          <Link
                            to={`/student/exam/${exam.id}/result`}
                            className="inline-flex items-center px-5 py-2.5 border border-gray-200 shadow-sm text-sm font-semibold rounded-xl text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all transform hover:-translate-y-0.5"
                          >
                            Xem kết quả
                          </Link>
                        </div>
                      ) : isBeforeStart ? (
                        <div className="text-gray-500 font-semibold bg-gray-100 px-5 py-2.5 rounded-xl border border-gray-200">
                          Chưa mở
                        </div>
                      ) : isAfterEnd ? (
                        <Link
                          to={`/student/exam/${exam.id}`}
                          className="inline-flex items-center px-5 py-2.5 border border-gray-200 shadow-sm text-sm font-semibold rounded-xl text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-300 transition-all transform hover:-translate-y-0.5"
                        >
                          Xem lại bài
                        </Link>
                      ) : (
                        <Link
                          to={`/student/exam/${exam.id}`}
                          className="inline-flex items-center px-5 py-2.5 border border-transparent text-sm font-semibold rounded-xl shadow-md text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 transition-all transform hover:-translate-y-0.5"
                        >
                          <PlayCircle className="w-5 h-5 mr-2" /> Vào bài
                        </Link>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
