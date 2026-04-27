import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/AuthContext';
import Login from './pages/Login';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import ExamBuilder from './pages/ExamBuilder';
import TakeExam from './pages/TakeExam';
import ExamResults from './pages/ExamResults';

import StudentExamResult from './pages/StudentExamResult';

const ProtectedRoute = ({ children, allowedRoles }: { children: React.ReactNode, allowedRoles?: string[] }) => {
  const { user, appUser, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  if (!user || !appUser) {
    return <Navigate to="/login" />;
  }

  if (allowedRoles && !allowedRoles.includes(appUser.role)) {
    return <Navigate to="/" />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { appUser, loading } = useAuth();

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        appUser?.role === 'teacher' ? <Navigate to="/teacher" /> :
        appUser?.role === 'student' ? <Navigate to="/student" /> :
        <Navigate to="/login" />
      } />
      
      {/* Teacher Routes */}
      <Route path="/teacher" element={
        <ProtectedRoute allowedRoles={['teacher']}>
          <TeacherDashboard />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exam/new" element={
        <ProtectedRoute allowedRoles={['teacher']}>
          <ExamBuilder />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exam/:examId/edit" element={
        <ProtectedRoute allowedRoles={['teacher']}>
          <ExamBuilder />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exam/:examId/results" element={
        <ProtectedRoute allowedRoles={['teacher']}>
          <ExamResults />
        </ProtectedRoute>
      } />

      {/* Student Routes */}
      <Route path="/student" element={
        <ProtectedRoute allowedRoles={['student']}>
          <StudentDashboard />
        </ProtectedRoute>
      } />
      <Route path="/student/exam/:examId" element={
        <ProtectedRoute allowedRoles={['student']}>
          <TakeExam />
        </ProtectedRoute>
      } />
      <Route path="/student/exam/:examId/result" element={
        <ProtectedRoute allowedRoles={['student']}>
          <StudentExamResult />
        </ProtectedRoute>
      } />
      <Route path="/teacher/exam/:examId/result/:studentId" element={
        <ProtectedRoute allowedRoles={['teacher']}>
          <StudentExamResult />
        </ProtectedRoute>
      } />
    </Routes>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
