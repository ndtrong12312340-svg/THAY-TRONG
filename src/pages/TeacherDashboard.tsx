import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, query, where, getDocs, addDoc, doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateEmail, updatePassword, deleteUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { Link } from 'react-router-dom';
import { Plus, Users, FileText, LogOut, Edit, Trash2, Upload, X, AlertTriangle, Clock, MessageCircle, RefreshCw, AlertCircle, CheckCircle, Send } from 'lucide-react';
import * as XLSX from 'xlsx';

// Secondary app for creating users without logging out the main user
const secondaryApp = getApps().find(app => app.name === 'Secondary') || initializeApp(firebaseConfig, 'Secondary');
const secondaryAuth = getAuth(secondaryApp);

export default function TeacherDashboard() {
  const { appUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'exams' | 'students' | 'facebook'>('exams');
  
  // Exams state
  const [exams, setExams] = useState<any[]>([]);
  
  // Students state
  const [students, setStudents] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [newStudent, setNewStudent] = useState({ name: '', email: '', password: '', className: '', facebook: '' });
  const [creatingStudent, setCreatingStudent] = useState(false);
  const [studentError, setStudentError] = useState('');
  
  const [isImporting, setIsImporting] = useState(false);
  const [viewingStudentExams, setViewingStudentExams] = useState<any>(null);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [editStudentData, setEditStudentData] = useState({ name: '', className: '', email: '', password: '' });
  const [updateStudentError, setUpdateStudentError] = useState('');
  const [isUpdatingStudent, setIsUpdatingStudent] = useState(false);
  const [editingFbStudent, setEditingFbStudent] = useState<any>(null);
  const [editFbData, setEditFbData] = useState({ facebook: '', phone: '' });
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [examToDelete, setExamToDelete] = useState<string | null>(null);
  const [examToExtend, setExamToExtend] = useState<any>(null);
  const [newEndTime, setNewEndTime] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncingExamId, setSyncingExamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    if (!appUser?.uid) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const qExams = query(collection(db, 'exams'), where('teacherId', '==', appUser.uid));
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

      const qStudents = query(collection(db, 'users'), where('role', '==', 'student'));
      const studentSnap = await getDocs(qStudents);
      const studentsList = studentSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort students by class name, then by first name (tên)
      studentsList.sort((a: any, b: any) => {
        const classA = a.className || '';
        const classB = b.className || '';
        const classCompare = classA.localeCompare(classB, 'vi');
        
        if (classCompare !== 0) return classCompare;
        
        const nameA = a.name || '';
        const nameB = b.name || '';
        
        const getFirstName = (fullName: string) => {
          const parts = fullName.trim().split(' ');
          return parts[parts.length - 1] || '';
        };
        
        const firstNameA = getFirstName(nameA);
        const firstNameB = getFirstName(nameB);
        
        const nameCompare = firstNameA.localeCompare(firstNameB, 'vi');
        if (nameCompare !== 0) return nameCompare;
        
        return nameA.localeCompare(nameB, 'vi');
      });
      setStudents(studentsList);
      
      // Removed global submissions fetch to save Firebase Quota
      // Submissions will only be fetched per-exam in ExamResults.tsx
      setSubmissions([]);
    } catch (err: any) {
      console.error("Error fetching data:", err);
      if (err.message && err.message.includes('Quota')) {
        setError('Hệ thống đang quá tải (vượt quá giới hạn truy cập miễn phí của Firebase). Vui lòng thử lại sau.');
      } else {
        setError('Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại.');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [appUser?.uid]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingStudent(true);
    setStudentError('');
    try {
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newStudent.email, newStudent.password);
      await setDoc(doc(db, 'users', userCredential.user.uid), {
        uid: userCredential.user.uid,
        email: newStudent.email,
        name: newStudent.name,
        className: newStudent.className,
        password: newStudent.password,
        role: 'student',
        createdAt: new Date().toISOString()
      });
      await signOut(secondaryAuth);
      setNewStudent({ name: '', email: '', password: '', className: '', facebook: '' });
      alert('Tạo học sinh thành công!');
    } catch (error: any) {
      console.error("Error creating student:", error);
      if (error.code === 'auth/email-already-in-use') {
        try {
          setStudentError('Email đã tồn tại. Đang kiểm tra mật khẩu để đồng bộ...');
          const signInCredential = await signInWithEmailAndPassword(secondaryAuth, newStudent.email, newStudent.password);
          await setDoc(doc(db, 'users', signInCredential.user.uid), {
            uid: signInCredential.user.uid,
            email: newStudent.email,
            name: newStudent.name,
            className: newStudent.className,
            password: newStudent.password,
            role: 'student',
            createdAt: new Date().toISOString()
          });
          await signOut(secondaryAuth);
          setNewStudent({ name: '', email: '', password: '', className: '', facebook: '' });
          alert('Tài khoản đã tồn tại. Dữ liệu đã được đồng bộ thành công!');
        } catch (signInError: any) {
          if (signInError.code === 'auth/wrong-password' || signInError.code === 'auth/invalid-credential') {
            setStudentError('Email này đã được sử dụng với một mật khẩu khác.');
          } else {
            setStudentError('Email đã tồn tại nhưng không thể khôi phục: ' + signInError.message);
          }
        }
      } else if (error.code === 'auth/operation-not-allowed') {
        setStudentError('LỖI CẤU HÌNH: Cần bật Email/Password trong Firebase Console.');
        alert('LỖI CẤU HÌNH FIREBASE:\n\nBạn cần bật phương thức đăng nhập "Email/Password" trong Authentication -> Sign-in method.');
      } else if (error.code === 'auth/invalid-email') {
        setStudentError('Địa chỉ email không hợp lệ (phải có dạng ten@mien.com).');
      } else if (error.code === 'auth/weak-password') {
        setStudentError('Mật khẩu quá yếu (phải có ít nhất 6 ký tự).');
      } else if (error.code === 'auth/invalid-credential') {
        setStudentError('Thông tin xác thực không hợp lệ. Vui lòng kiểm tra lại email và mật khẩu.');
      } else {
        setStudentError('Lỗi: ' + error.message);
      }
    } finally {
      setCreatingStudent(false);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setStudentError('');
    
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet) as any[];

        let successCount = 0;
        let errorCount = 0;
        let isOperationNotAllowed = false;
        let emailInUseCount = 0;
        let invalidEmailCount = 0;
        let weakPasswordCount = 0;
        let missingDataCount = 0;
        let wrongPasswordCount = 0;
        let otherErrorMessages: string[] = [];

        for (const row of json) {
          const name = row['FullName'] || row['Họ và tên'];
          const className = row['Class'] || row['Lớp'];
          const email = row['Email']?.toString().trim();
          const password = row['Password'] || row['Mật khẩu'];
          const facebook = row['Facebook'] || row['FB'] || row['Link Facebook'] || '';
          const role = row['Role'];

          // Skip if role is explicitly set to something other than student
          if (role && String(role).toLowerCase() !== 'student') {
            continue;
          }

          if (name && className && email && password) {
            try {
              const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, String(password));
              await setDoc(doc(db, 'users', userCredential.user.uid), {
                uid: userCredential.user.uid,
                email: email,
                name: String(name).trim(),
                className: String(className).trim(),
                password: String(password),
                facebook: String(facebook).trim(),
                role: 'student',
                createdAt: new Date().toISOString()
              });
              await signOut(secondaryAuth);
              successCount++;
            } catch (err: any) {
              if (err.code === 'auth/email-already-in-use') {
                try {
                  // Attempt to recover by signing in
                  const signInCredential = await signInWithEmailAndPassword(secondaryAuth, email, String(password));
                  await setDoc(doc(db, 'users', signInCredential.user.uid), {
                    uid: signInCredential.user.uid,
                    email: email,
                    name: String(name).trim(),
                    className: String(className).trim(),
                    password: String(password),
                    facebook: String(facebook).trim(),
                    role: 'student',
                    createdAt: new Date().toISOString()
                  });
                  await signOut(secondaryAuth);
                  successCount++;
                } catch (signInErr: any) {
                  console.error("Lỗi khôi phục tài khoản cho", email, signInErr);
                  if (signInErr.code === 'auth/wrong-password' || signInErr.code === 'auth/invalid-credential') {
                    wrongPasswordCount++;
                  } else {
                    emailInUseCount++;
                  }
                  errorCount++;
                }
              } else {
                console.error("Lỗi tạo tài khoản cho", email, err);
                if (err.code === 'auth/operation-not-allowed') {
                  isOperationNotAllowed = true;
                } else if (err.code === 'auth/invalid-email') {
                  invalidEmailCount++;
                } else if (err.code === 'auth/weak-password') {
                  weakPasswordCount++;
                } else {
                  otherErrorMessages.push(`${email}: ${err.message}`);
                }
                errorCount++;
              }
            }
          } else {
            missingDataCount++;
            errorCount++;
          }
        }
        
        if (isOperationNotAllowed) {
          setStudentError('LỖI CẤU HÌNH: Chức năng Email/Password chưa được bật trong Firebase Console.');
          alert('LỖI CẤU HÌNH FIREBASE:\n\nBạn CẦN BẬT "Email/Password" trong Authentication -> Sign-in method để nhập học sinh từ Excel.');
        } else {
          let msg = `Nhập thành công: ${successCount} học sinh.\n`;
          if (errorCount > 0) {
            msg += `Thất bại: ${errorCount} dòng.\nChi tiết lỗi:\n`;
            if (emailInUseCount > 0) msg += `- ${emailInUseCount} email đã tồn tại.\n`;
            if (wrongPasswordCount > 0) msg += `- ${wrongPasswordCount} email đã tồn tại nhưng sai mật khẩu (không thể cập nhật).\n`;
            if (invalidEmailCount > 0) msg += `- ${invalidEmailCount} email không hợp lệ (sai định dạng).\n`;
            if (weakPasswordCount > 0) msg += `- ${weakPasswordCount} mật khẩu quá yếu (dưới 6 ký tự).\n`;
            if (missingDataCount > 0) msg += `- ${missingDataCount} dòng thiếu dữ liệu (tên, lớp, email hoặc mật khẩu).\n`;
            if (otherErrorMessages.length > 0) {
              msg += `- Lỗi khác:\n  + ${otherErrorMessages.slice(0, 3).join('\n  + ')}`;
              if (otherErrorMessages.length > 3) msg += `\n  + ... và ${otherErrorMessages.length - 3} lỗi khác.`;
            }
          }
          alert(msg);
        }
      } catch (err: any) {
        setStudentError('Lỗi đọc file Excel: ' + err.message);
      } finally {
        setIsImporting(false);
        e.target.value = ''; // Reset file input
      }
    };
    reader.onerror = () => {
      setStudentError('Lỗi đọc file.');
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleUpdateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingStudent) return;
    
    setIsUpdatingStudent(true);
    setUpdateStudentError('');
    
    try {
      const emailChanged = editStudentData.email !== editingStudent.email;
      const passwordChanged = editStudentData.password !== editingStudent.password;

      if (emailChanged || passwordChanged) {
        if (!editingStudent.password) {
          setUpdateStudentError("Không thể đổi Email/Mật khẩu vì mật khẩu cũ không được lưu trong hệ thống (tài khoản cũ). Vui lòng tạo tài khoản mới.");
          setIsUpdatingStudent(false);
          return;
        }
        
        if (passwordChanged && editStudentData.password.length < 6) {
          setUpdateStudentError("Mật khẩu mới phải có ít nhất 6 ký tự.");
          setIsUpdatingStudent(false);
          return;
        }

        try {
          let userCredential;
          try {
            userCredential = await signInWithEmailAndPassword(secondaryAuth, editingStudent.email, editingStudent.password);
          } catch (signInErr: any) {
            // Recovery: If email or password was previously updated in Auth but not Firestore
            if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/wrong-password') {
              let recovered = false;
              
              // Try 1: Old email, New password
              if (!recovered && passwordChanged) {
                try {
                  userCredential = await signInWithEmailAndPassword(secondaryAuth, editingStudent.email, editStudentData.password);
                  recovered = true;
                } catch (e) {}
              }
              
              // Try 2: New email, Old password
              if (!recovered && emailChanged) {
                try {
                  userCredential = await signInWithEmailAndPassword(secondaryAuth, editStudentData.email, editingStudent.password);
                  recovered = true;
                } catch (e) {}
              }
              
              // Try 3: New email, New password
              if (!recovered && emailChanged && passwordChanged) {
                try {
                  userCredential = await signInWithEmailAndPassword(secondaryAuth, editStudentData.email, editStudentData.password);
                  recovered = true;
                } catch (e) {}
              }
              
              if (!recovered) {
                throw signInErr; // Throw original error if all recovery attempts fail
              }
            } else {
              throw signInErr;
            }
          }
          
          if (emailChanged && userCredential.user.email !== editStudentData.email) {
            await updateEmail(userCredential.user, editStudentData.email);
          }
          if (passwordChanged) {
            // Only update password if we didn't just use it to recover the account
            const usedNewPasswordToRecover = userCredential && userCredential.user && 
              (editStudentData.password !== editingStudent.password); // We can't easily check what password was used to sign in, but if we reached here and passwordChanged is true, we should just update it to be safe.
            // Actually, updatePassword doesn't hurt if it's the same password.
            await updatePassword(userCredential.user, editStudentData.password);
          }
          
          await signOut(secondaryAuth);
        } catch (authError: any) {
          console.error("Auth update error:", authError);
          if (authError.code === 'auth/weak-password') {
            setUpdateStudentError("Mật khẩu mới quá yếu (phải có ít nhất 6 ký tự).");
          } else if (authError.code === 'auth/invalid-email') {
            setUpdateStudentError("Email mới không hợp lệ.");
          } else if (authError.code === 'auth/email-already-in-use') {
            setUpdateStudentError("Email mới đã được sử dụng bởi một tài khoản khác.");
          } else if (authError.code === 'auth/wrong-password' || authError.code === 'auth/invalid-credential') {
            setUpdateStudentError("Không thể xác thực. Mật khẩu cũ lưu trong hệ thống không khớp với mật khẩu thực tế của tài khoản.");
          } else if (authError.code === 'auth/too-many-requests') {
            setUpdateStudentError("Quá nhiều yêu cầu. Vui lòng thử lại sau.");
          } else {
            setUpdateStudentError("Lỗi hệ thống xác thực: " + authError.message);
          }
          setIsUpdatingStudent(false);
          return;
        }
      }

      await updateDoc(doc(db, 'users', editingStudent.id), {
        name: editStudentData.name,
        className: editStudentData.className,
        email: editStudentData.email,
        password: editStudentData.password
      });
      setEditingStudent(null);
    } catch (error: any) {
      console.error("Firestore update error:", error);
      setUpdateStudentError("Lỗi cập nhật dữ liệu: " + (error.message || "Không xác định"));
    } finally {
      setIsUpdatingStudent(false);
    }
  };

  const handleUpdateFacebook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFbStudent) return;
    try {
      await updateDoc(doc(db, 'users', editingFbStudent.id), {
        facebook: editFbData.facebook,
        phone: editFbData.phone
      });
      setEditingFbStudent(null);
      fetchData();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${editingFbStudent.id}`);
    }
  };

  const [isDeletingStudent, setIsDeletingStudent] = useState(false);
  const [deleteStudentError, setDeleteStudentError] = useState('');

  const handleDeleteStudent = async () => {
    if (!studentToDelete) return;
    setIsDeletingStudent(true);
    setDeleteStudentError('');
    try {
      const student = students.find(s => s.id === studentToDelete);
      if (student) {
        try {
          const userCredential = await signInWithEmailAndPassword(secondaryAuth, student.email, student.password);
          await deleteUser(userCredential.user);
          await signOut(secondaryAuth);
        } catch (authError: any) {
          console.warn("Auth delete error (ignoring to allow Firestore deletion):", authError);
          // We ignore the auth error so the teacher can at least remove the student from the class list.
          // The Auth user might be orphaned, but without a Firestore doc, they have no access.
        }
      }

      await deleteDoc(doc(db, 'users', studentToDelete));
      setStudentToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${studentToDelete}`);
    } finally {
      setIsDeletingStudent(false);
    }
  };

  const handleDeleteAllStudents = async () => {
    try {
      // In a real app, you might want to do this in batches if there are many students
      const deletePromises = students.map(student => deleteDoc(doc(db, 'users', student.id)));
      await Promise.all(deletePromises);
      setIsDeletingAll(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users`);
    }
  };

  const handleDeleteExam = async () => {
    if (!examToDelete) return;
    try {
      await deleteDoc(doc(db, 'exams', examToDelete));
      setExamToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `exams/${examToDelete}`);
    }
  };

  const handleSyncOldData = async (examId: string) => {
    setSyncingExamId(examId);
    try {
      // 1. Fetch all submissions for this exam
      const qSubmissions = query(collection(db, 'submissions'), where('examId', '==', examId));
      const subSnap = await getDocs(qSubmissions);
      const subs = subSnap.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      // 2. Get unique submissions (latest per student)
      const map = new Map();
      subs.forEach(sub => {
        if (!map.has(sub.studentId)) {
          map.set(sub.studentId, sub);
        } else {
          const existing = map.get(sub.studentId);
          if (new Date(sub.submittedAt).getTime() > new Date(existing.submittedAt).getTime()) {
            map.set(sub.studentId, sub);
          }
        }
      });
      const uniqueSubs = Array.from(map.values());

      // 3. Build summary
      const summary = uniqueSubs.map(s => {
        const student = students.find(st => st.uid === s.studentId);
        return {
          submissionId: s.id,
          studentId: s.studentId,
          studentName: student ? student.name : 'Học sinh',
          score: s.score,
          incorrectQuestions: s.incorrectQuestions || [],
          submittedAt: s.submittedAt
        };
      });

      // 4. Update exam document
      await updateDoc(doc(db, 'exams', examId), {
        submissionSummary: summary
      });

      // 5. Update local state
      setExams(exams.map(e => e.id === examId ? { ...e, submissionSummary: summary } : e));
      alert('Đồng bộ dữ liệu cũ thành công!');
    } catch (error) {
      console.error("Error syncing old data:", error);
      alert('Có lỗi xảy ra khi đồng bộ dữ liệu.');
    } finally {
      setSyncingExamId(null);
    }
  };

  const handleExtendTime = async () => {
    if (!examToExtend || !newEndTime) return;
    try {
      const examRef = doc(db, 'exams', examToExtend.id);
      await updateDoc(examRef, { endTime: newEndTime });
      setExamToExtend(null);
      setNewEndTime('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `exams/${examToExtend.id}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-xl font-bold text-white tracking-wide">Giáo viên: {appUser?.name}</h1>
            </div>
            <div className="flex items-center space-x-4">
              <button onClick={fetchData} disabled={isRefreshing} className="text-indigo-100 hover:text-white flex items-center transition-colors font-medium mr-2">
                <RefreshCw className={`w-5 h-5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} /> Làm mới
              </button>
              <button onClick={logout} className="text-indigo-100 hover:text-white flex items-center transition-colors font-medium">
                <LogOut className="w-5 h-5 mr-1" /> Đăng xuất
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start">
            <AlertCircle className="w-5 h-5 text-rose-600 mr-3 mt-0.5 flex-shrink-0" />
            <div className="text-rose-700 font-medium">{error}</div>
          </div>
        )}
        <div className="flex space-x-4 mb-8">
          <button
            onClick={() => setActiveTab('exams')}
            className={`px-6 py-2.5 rounded-full font-semibold flex items-center transition-all duration-200 shadow-sm ${activeTab === 'exams' ? 'bg-indigo-600 text-white shadow-md transform -translate-y-0.5' : 'bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-700'}`}
          >
            <FileText className="w-5 h-5 mr-2" /> Quản lý Đề thi
          </button>
          <button
            onClick={() => setActiveTab('students')}
            className={`px-6 py-2.5 rounded-full font-semibold flex items-center transition-all duration-200 shadow-sm ${activeTab === 'students' ? 'bg-indigo-600 text-white shadow-md transform -translate-y-0.5' : 'bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-700'}`}
          >
            <Users className="w-5 h-5 mr-2" /> Quản lý Học sinh
          </button>
          <button
            onClick={() => setActiveTab('facebook')}
            className={`px-6 py-2.5 rounded-full font-semibold flex items-center transition-all duration-200 shadow-sm ${activeTab === 'facebook' ? 'bg-indigo-600 text-white shadow-md transform -translate-y-0.5' : 'bg-white text-gray-600 hover:bg-indigo-50 hover:text-indigo-700'}`}
          >
            <MessageCircle className="w-5 h-5 mr-2" /> Liên hệ / Zalo
          </button>
        </div>

        {activeTab === 'exams' && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Danh sách Đề thi</h2>
              <Link to="/teacher/exam/new" className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 py-2.5 rounded-full font-medium flex items-center hover:from-indigo-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg transform hover:-translate-y-0.5">
                <Plus className="w-5 h-5 mr-1" /> Tạo đề thi mới
              </Link>
            </div>
            <div className="bg-white shadow-md overflow-hidden sm:rounded-2xl border border-gray-100">
              <ul className="divide-y divide-gray-100">
                {exams.length === 0 ? (
                  <li className="px-6 py-12 text-center text-gray-500">
                    <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <p className="text-lg font-medium">Chưa có đề thi nào.</p>
                    <p className="text-sm mt-1">Hãy tạo đề thi đầu tiên của bạn!</p>
                  </li>
                ) : exams.map((exam, index) => (
                  <li key={exam.id} className="hover:bg-indigo-50/50 transition-colors duration-150">
                    <div className="px-6 py-5 flex justify-between items-center">
                      <div className="flex items-start">
                        <span className="text-xl font-black text-indigo-200 w-8 flex-shrink-0 mt-0.5">{index + 1}.</span>
                        <div>
                          <h3 className="text-lg font-bold text-gray-900 truncate mb-1">{exam.title}</h3>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                            <span className="flex items-center bg-gray-100 px-2.5 py-1 rounded-md font-medium">
                              <Clock className="w-4 h-4 mr-1.5 text-gray-500" /> {exam.duration} phút
                            </span>
                            <span className={`px-2.5 py-1 rounded-md font-medium ${exam.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                              {exam.status === 'published' ? 'Đã giao' : 'Bản nháp'}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-gray-600 flex items-center">
                            <span className="font-medium mr-1">Lớp được giao:</span> {exam.assignedClasses?.join(', ') || 'Chưa giao'}
                          </p>
                          {(exam.startTime || exam.endTime) && (
                            <p className="mt-1 text-sm text-gray-500">
                              Thời gian mở: {exam.startTime ? new Date(exam.startTime).toLocaleString('vi-VN') : 'Không giới hạn'} - {exam.endTime ? new Date(exam.endTime).toLocaleString('vi-VN') : 'Không giới hạn'}
                            </p>
                          )}
                          <div className="mt-1 flex items-center space-x-3">
                            <p className="text-sm font-semibold text-indigo-600">
                              Đã nộp: {exam.submissionSummary ? (() => {
                                const uniqueStudents = new Set(exam.submissionSummary.map((s: any) => s.studentId));
                                return uniqueStudents.size;
                              })() : 0} học sinh
                            </p>
                            {exam.submissionSummary === undefined && (
                              <button
                                onClick={() => handleSyncOldData(exam.id)}
                                disabled={syncingExamId === exam.id}
                                className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded hover:bg-amber-200 transition-colors flex items-center"
                              >
                                {syncingExamId === exam.id ? (
                                  <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3 h-3 mr-1" />
                                )}
                                Đồng bộ dữ liệu cũ
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        {exam.status === 'published' && (
                          <>
                            <button
                              onClick={() => {
                                const text = `📢 THÔNG BÁO BÀI TẬP MỚI 📢\n\n📌 Bài tập: ${exam.title}\n👥 Dành cho lớp: ${exam.assignedClasses?.join(', ') || 'Tất cả'}\n⏱️ Thời gian làm bài: ${exam.duration} phút\n\n👉 Các em vào link sau để làm bài nhé:\n🔗 Liên kết: https://thay-trong.vercel.app`;
                                navigator.clipboard.writeText(text);
                                alert('Đã copy thông báo vào khay nhớ tạm. Dán (Ctrl+V) vào nhóm Zalo để gửi cho học sinh!');
                                window.open('https://chat.zalo.me/', '_blank');
                              }}
                              className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg font-medium text-sm transition-colors flex items-center"
                              title="Thông báo bài tập mới qua Zalo"
                            >
                              <MessageCircle className="w-4 h-4 mr-1" />
                              Báo Zalo
                            </button>
                            <button
                              onClick={() => {
                                const text = `📢 THÔNG BÁO BÀI TẬP MỚI 📢\n\n📌 Bài tập: ${exam.title}\n👥 Dành cho lớp: ${exam.assignedClasses?.join(', ') || 'Tất cả'}\n⏱️ Thời gian làm bài: ${exam.duration} phút\n\n👉 Các em vào link sau để làm bài nhé:\n🔗 Liên kết: https://thay-trong.vercel.app`;
                                navigator.clipboard.writeText(text);
                                alert('Đã copy thông báo vào khay nhớ tạm. Dán (Ctrl+V) vào nhóm Facebook để gửi cho học sinh!');
                                window.open('https://facebook.com/messages', '_blank');
                              }}
                              className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium text-sm transition-colors flex items-center"
                              title="Thông báo bài tập mới qua Facebook"
                            >
                              <MessageCircle className="w-4 h-4 mr-1" />
                              Báo Facebook
                            </button>
                            <button
                              onClick={() => {
                                setExamToExtend(exam);
                                setNewEndTime(exam.endTime || '');
                              }}
                              className="px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg font-medium text-sm transition-colors"
                            >
                              Gia hạn
                            </button>
                            <Link to={`/teacher/exam/${exam.id}/results`} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium text-sm transition-colors">
                              Xem kết quả
                            </Link>
                          </>
                        )}
                        <Link to={`/teacher/exam/${exam.id}/edit`} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Chỉnh sửa">
                          <Edit className="w-5 h-5" />
                        </Link>
                        <button 
                          onClick={() => setExamToDelete(exam.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" 
                          title="Xóa"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'students' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-1">
              <div className="bg-white shadow-lg rounded-2xl p-6 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">Tạo tài khoản học sinh</h3>
                <form onSubmit={handleCreateStudent} className="space-y-5">
                  {studentError && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-md">
                      <div className="flex">
                        <div className="flex-shrink-0">
                          <AlertTriangle className="h-5 w-5 text-red-500" />
                        </div>
                        <div className="ml-3">
                          <p className="text-sm text-red-700 font-medium">{studentError}</p>
                        </div>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Họ và tên</label>
                    <input type="text" required value={newStudent.name} onChange={e => setNewStudent({...newStudent, name: e.target.value})} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Lớp</label>
                    <input type="text" required value={newStudent.className} onChange={e => setNewStudent({...newStudent, className: e.target.value})} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Email</label>
                    <input type="email" required value={newStudent.email} onChange={e => setNewStudent({...newStudent, email: e.target.value})} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Mật khẩu</label>
                    <input type="password" required minLength={6} value={newStudent.password} onChange={e => setNewStudent({...newStudent, password: e.target.value})} className="block w-full border border-gray-300 rounded-xl shadow-sm py-2.5 px-4 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors" />
                  </div>
                  <button type="submit" disabled={creatingStudent} className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-md text-sm font-bold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 transition-all transform hover:-translate-y-0.5">
                    {creatingStudent ? 'Đang tạo...' : 'Tạo tài khoản'}
                  </button>
                </form>

                <div className="mt-8 pt-6 border-t border-gray-100">
                  <h4 className="text-sm font-bold text-gray-900 mb-2">Hoặc nhập từ file Excel</h4>
                  <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                    File Excel cần có các cột: <strong>FullName</strong>, <strong>Class</strong>, <strong>Email</strong>, <strong>Password</strong>, <strong>Facebook</strong> (có thể thêm cột <strong>Role</strong> là "student").
                  </p>
                  <label className="w-full flex justify-center items-center py-3 px-4 border-2 border-dashed border-indigo-300 rounded-xl shadow-sm text-sm font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 cursor-pointer transition-colors">
                    {isImporting ? <span className="animate-pulse">Đang nhập...</span> : <><Upload className="w-5 h-5 mr-2" /> Chọn file Excel</>}
                    <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleImportExcel} disabled={isImporting} />
                  </label>
                </div>
              </div>
            </div>
            <div className="md:col-span-2">
              <div className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
                <div className="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                  <h3 className="text-lg font-bold text-gray-900">Danh sách học sinh</h3>
                  {students.length > 0 && (
                    <button 
                      onClick={() => setIsDeletingAll(true)}
                      className="text-sm bg-red-50 text-red-600 hover:bg-red-100 px-4 py-2 rounded-lg flex items-center font-bold transition-colors"
                    >
                      <Trash2 className="w-4 h-4 mr-2" /> Xóa toàn bộ
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full table-fixed divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="w-[22%] px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Họ tên</th>
                        <th className="w-[8%] px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Lớp</th>
                        <th className="w-[24%] px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Email</th>
                        <th className="w-[12%] px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Mật khẩu</th>
                        <th className="w-[24%] px-3 py-3 text-center text-xs font-bold text-gray-500 uppercase tracking-wider">Tiến độ làm bài</th>
                        <th className="w-[10%] px-3 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {students.map((student) => {
                        const now = new Date();
                        
                        const assignedExamsList = exams.filter(exam => 
                          exam.status === 'published' && 
                          exam.assignedClasses && 
                          exam.assignedClasses.includes(student.className)
                        );
                        
                        const totalAssignedExams = assignedExamsList.length;
                        
                        const openedExams = assignedExamsList.filter(exam => 
                          (!exam.startTime || new Date(exam.startTime) <= now)
                        ).length;

                        // Calculate completed exams using submissionSummary
                        const completedExams = assignedExamsList.filter(exam => {
                          if (!exam.submissionSummary) return false;
                          return exam.submissionSummary.some((s: any) => s.studentId === student.id);
                        }).length;
                        
                        return (
                        <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-3 text-sm font-semibold text-gray-900 truncate" title={student.name}>{student.name}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-sm text-gray-600">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                              {student.className}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600 truncate" title={student.email}>{student.email}</td>
                          <td className="px-3 py-3 whitespace-nowrap text-xs text-gray-500">
                            <span className="font-mono bg-gray-50 rounded px-1.5 py-1">{student.password || '***'}</span>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-center text-sm font-medium">
                            <div 
                              className="flex flex-col items-center justify-center cursor-pointer hover:bg-emerald-50 p-2 rounded-lg transition-colors border border-transparent hover:border-emerald-100"
                              onClick={() => setViewingStudentExams(student)}
                              title="Xem chi tiết bài làm của học sinh này"
                            >
                              <span className="text-base font-bold text-emerald-600">
                                {completedExams} <span className="text-gray-400 text-xs font-normal">/ {openedExams} / {totalAssignedExams}</span>
                              </span>
                              <span className="text-[9px] text-gray-500 uppercase tracking-wider mt-0.5">Đã làm / Đã mở / Đã giao</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap text-right text-sm font-medium">
                            <div className="flex justify-end space-x-2">
                              <button 
                                onClick={() => {
                                  setEditingStudent(student);
                                  setEditStudentData({ name: student.name, className: student.className || '', email: student.email || '', password: student.password || '' });
                                  setUpdateStudentError('');
                                }}
                                className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="Chỉnh sửa"
                              >
                                <Edit className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => setStudentToDelete(student.id)}
                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Xóa"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {activeTab === 'facebook' && (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="bg-white shadow-sm rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Danh sách Liên hệ / Zalo</h3>
                <p className="text-sm text-gray-500 mt-1">Quản lý số điện thoại Zalo và link Facebook của học sinh</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Họ tên</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Lớp</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Số Zalo/SĐT</th>
                    <th className="px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Link Facebook</th>
                    <th className="px-6 py-4 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {students.map((student) => (
                    <tr key={student.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{student.name}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {student.className}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{student.email}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {student.phone ? (
                          <div className="flex items-center space-x-2">
                            <span>{student.phone}</span>
                            <button
                              onClick={() => {
                                const assigned = exams.filter(e => e.status === 'published' && e.assignedClasses?.includes(student.className));
                                const uncompleted = assigned.filter(e => {
                                  if (!e.submissionSummary) return true; // assuming not done if not synced
                                  return !e.submissionSummary.some((s: any) => s.studentId === student.id);
                                });
                                
                                if (uncompleted.length > 0) {
                                  const text = `🚨 NHẮC NHỞ LÀM BÀI TẬP 🚨\n\nChào ${student.name}, hệ thống ghi nhận em còn các bài tập sau chưa hoàn thành (hoặc giáo viên chưa đồng bộ điểm):\n${uncompleted.map(e => '📌 ' + e.title).join('\n')}\n\n👉 Em vui lòng đăng nhập vào hệ thống để kiểm tra và làm bài nhé!\n🔗 Link: https://thay-trong.vercel.app`;
                                  navigator.clipboard.writeText(text);
                                  alert(`Đã copy tự động tin nhắn nhắc ${uncompleted.length} bài tập chưa làm. Bạn có thể dán (Ctrl+V) trực tiếp vào Zalo của học sinh!`);
                                } else {
                                  const text = `Chào ${student.name}, em lưu ý thường xuyên kiểm tra bài tập mới trên hệ thống nhé!\n🔗 Link: https://thay-trong.vercel.app`;
                                  navigator.clipboard.writeText(text);
                                  alert('Học sinh đã làm hết các bài tập (hoặc đã nộp đầy đủ). Hệ thống đã copy thông báo chung vào khay nhớ tạm!');
                                }
                                window.open(`https://chat.zalo.me/?phone=${student.phone.replace(/[^0-9]/g, '')}`, '_blank');
                              }}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors flex items-center"
                              title="Nhắc nhở làm bài qua Zalo"
                            >
                              <MessageCircle className="w-4 h-4 mr-1" />
                              <span className="text-xs font-medium">Nhắc nhở</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Chưa có</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {student.facebook ? (
                          <div className="flex items-center space-x-2">
                            <a href={student.facebook} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 font-medium flex items-center max-w-[120px] truncate" title={student.facebook}>
                              FB Link
                            </a>
                            <button
                              onClick={() => {
                                const assigned = exams.filter(e => e.status === 'published' && e.assignedClasses?.includes(student.className));
                                const uncompleted = assigned.filter(e => {
                                  if (!e.submissionSummary) return true;
                                  return !e.submissionSummary.some((s: any) => s.studentId === student.id);
                                });
                                
                                if (uncompleted.length > 0) {
                                  const text = `🚨 NHẮC NHỞ LÀM BÀI TẬP 🚨\n\nChào ${student.name}, hệ thống ghi nhận em còn các bài tập sau chưa hoàn thành (hoặc giáo viên chưa đồng bộ điểm):\n${uncompleted.map(e => '📌 ' + e.title).join('\n')}\n\n👉 Em vui lòng đăng nhập vào hệ thống để kiểm tra và làm bài nhé!\n🔗 Link: https://thay-trong.vercel.app`;
                                  navigator.clipboard.writeText(text);
                                  alert(`Đã copy tự động tin nhắn nhắc ${uncompleted.length} bài tập chưa làm. Bạn có thể dán (Ctrl+V) trực tiếp vào Facebook của học sinh!`);
                                } else {
                                  const text = `Chào ${student.name}, em lưu ý thường xuyên kiểm tra bài tập mới trên hệ thống nhé!\n🔗 Link: https://thay-trong.vercel.app`;
                                  navigator.clipboard.writeText(text);
                                  alert('Học sinh đã làm hết các bài tập (hoặc đã nộp đầy đủ). Hệ thống đã copy thông báo chung vào khay nhớ tạm!');
                                }
                                window.open(student.facebook, '_blank');
                              }}
                              className="text-indigo-600 hover:text-indigo-800 p-1 rounded hover:bg-indigo-50 transition-colors flex items-center"
                              title="Nhắc nhở làm bài qua Facebook"
                            >
                              <MessageCircle className="w-4 h-4 mr-1" />
                              <span className="text-xs font-medium">Nhắc nhở</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">Chưa cập nhật</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => {
                            setEditingFbStudent(student);
                            setEditFbData({ facebook: student.facebook || '', phone: student.phone || '' });
                          }}
                          className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="Cập nhật Liên hệ"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contacts Modal */}
      {editingFbStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Cập nhật Liên hệ</h3>
            <p className="text-sm text-gray-600 mb-4">Học sinh: <span className="font-semibold">{editingFbStudent.name}</span></p>
            <form onSubmit={handleUpdateFacebook}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700">Số điện thoại / Zalo</label>
                <input type="tel" value={editFbData.phone} onChange={e => setEditFbData({...editFbData, phone: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="0912..." />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700">Đường link Facebook</label>
                <input type="url" value={editFbData.facebook} onChange={e => setEditFbData({...editFbData, facebook: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="https://facebook.com/..." />
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button type="button" onClick={() => setEditingFbStudent(null)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                  Hủy
                </button>
                <button type="submit" className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Viewing Student Exams Modal */}
      {viewingStudentExams && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bold text-gray-900">Bài làm của học sinh</h3>
                <p className="text-sm text-gray-500 mt-1">
                  <span className="font-semibold text-indigo-600">{viewingStudentExams.name}</span> - Lớp {viewingStudentExams.className}
                </p>
              </div>
              <button onClick={() => setViewingStudentExams(null)} className="text-gray-400 hover:text-gray-500 p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {(() => {
                const assignedExamsList = exams.filter(exam => 
                  exam.status === 'published' && 
                  exam.assignedClasses && 
                  exam.assignedClasses.includes(viewingStudentExams.className)
                );

                if (assignedExamsList.length === 0) {
                  return <div className="text-center py-8 text-gray-500">Chưa có bài thi nào được giao cho lớp này.</div>;
                }

                return (
                  <div className="space-y-4">
                    {assignedExamsList.map(exam => {
                      const submission = exam.submissionSummary?.find((s: any) => s.studentId === viewingStudentExams.id);
                      const isCompleted = !!submission;
                      
                      return (
                        <div key={exam.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <h4 className="font-semibold text-gray-900 text-lg">{exam.title}</h4>
                            <div className="flex items-center text-sm text-gray-500 mt-1 space-x-4">
                              <span className="flex items-center"><Clock className="w-3.5 h-3.5 mr-1" /> {exam.duration} phút</span>
                              {isCompleted ? (
                                <span className="flex items-center text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-md">
                                  <CheckCircle className="w-3.5 h-3.5 mr-1" /> Đã nộp bài
                                </span>
                              ) : (
                                <span className="flex items-center text-amber-600 font-medium bg-amber-50 px-2 py-0.5 rounded-md">
                                  <AlertCircle className="w-3.5 h-3.5 mr-1" /> Chưa làm
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between sm:justify-end gap-4 min-w-[140px]">
                            {isCompleted && (
                              <div className="text-right">
                                <div className="text-2xl font-black text-indigo-600 leading-none">{submission.score}</div>
                                <div className="text-[10px] text-gray-500 uppercase font-bold tracking-wider mt-1">Điểm số</div>
                              </div>
                            )}
                            
                            {isCompleted && (
                              <button
                                onClick={() => {
                                  // Navigate to the result page
                                  window.open(`/teacher/exam/${exam.id}/result/${viewingStudentExams.id}`, '_blank');
                                }}
                                className="px-4 py-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg font-medium text-sm transition-colors whitespace-nowrap"
                              >
                                Xem chi tiết
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Modal */}
      {editingStudent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Chỉnh sửa Học sinh</h3>
              <button onClick={() => setEditingStudent(null)} className="text-gray-400 hover:text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            {updateStudentError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
                {updateStudentError}
              </div>
            )}
            <form onSubmit={handleUpdateStudent} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Họ và tên</label>
                <input type="text" required value={editStudentData.name} onChange={e => setEditStudentData({...editStudentData, name: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Lớp</label>
                <input type="text" required value={editStudentData.className} onChange={e => setEditStudentData({...editStudentData, className: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Email</label>
                <input type="email" required value={editStudentData.email} onChange={e => setEditStudentData({...editStudentData, email: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Mật khẩu</label>
                <input type="text" required value={editStudentData.password} onChange={e => setEditStudentData({...editStudentData, password: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                <p className="mt-1 text-xs text-gray-500">Lưu ý: Thay đổi email hoặc mật khẩu ở đây sẽ cập nhật trực tiếp tài khoản đăng nhập của học sinh.</p>
              </div>
              <div className="pt-4 flex justify-end space-x-3">
                <button type="button" onClick={() => setEditingStudent(null)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50" disabled={isUpdatingStudent}>
                  Hủy
                </button>
                <button type="submit" className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 flex items-center" disabled={isUpdatingStudent}>
                  {isUpdatingStudent ? 'Đang lưu...' : 'Lưu thay đổi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Confirm Modal */}
      {studentToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4 text-red-600">
              <AlertTriangle className="w-6 h-6 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">Xác nhận xóa học sinh</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Bạn có chắc chắn muốn xóa học sinh này không? Hành động này không thể hoàn tác và sẽ xóa cả tài khoản đăng nhập của học sinh.
            </p>
            {deleteStudentError && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md">
                {deleteStudentError}
              </div>
            )}
            <div className="flex justify-end space-x-3">
              <button onClick={() => {
                setStudentToDelete(null);
                setDeleteStudentError('');
              }} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50" disabled={isDeletingStudent}>
                Hủy
              </button>
              <button onClick={handleDeleteStudent} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700 flex items-center" disabled={isDeletingStudent}>
                {isDeletingStudent ? 'Đang xóa...' : 'Xóa học sinh'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Students Confirm Modal */}
      {isDeletingAll && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4 text-red-600">
              <AlertTriangle className="w-6 h-6 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">Xác nhận xóa TOÀN BỘ học sinh</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Bạn có chắc chắn muốn xóa <strong>tất cả {students.length} học sinh</strong> không? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setIsDeletingAll(false)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                Hủy
              </button>
              <button onClick={handleDeleteAllStudents} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                Xóa toàn bộ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Exam Confirm Modal */}
      {examToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4 text-red-600">
              <AlertTriangle className="w-6 h-6 mr-2" />
              <h3 className="text-lg font-medium text-gray-900">Xác nhận xóa đề thi</h3>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              Bạn có chắc chắn muốn xóa đề thi này không? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setExamToDelete(null)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                Hủy
              </button>
              <button onClick={handleDeleteExam} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700">
                Xóa đề thi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Extend Time Modal */}
      {examToExtend && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Gia hạn thời gian</h3>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">Thời gian kết thúc mới</label>
              <input 
                type="datetime-local" 
                value={newEndTime} 
                onChange={(e) => setNewEndTime(e.target.value)}
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setExamToExtend(null)} className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
                Hủy
              </button>
              <button onClick={handleExtendTime} className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
