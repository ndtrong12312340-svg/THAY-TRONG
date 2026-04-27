import React, { useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { Navigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';

export default function Login() {
  const { user, appUser, loginWithGoogle } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (user && appUser) {
    return <Navigate to="/" />;
  }

  const handleTeacherLogin = async () => {
    try {
      setError('');
      await loginWithGoogle();
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed' || err.message?.includes('network-request-failed')) {
        setError('Lỗi kết nối mạng hoặc trình duyệt chặn popup/cookie. Vui lòng thử mở ứng dụng trong tab mới (nhấn vào biểu tượng mở tab mới ở góc trên bên phải) hoặc tắt trình chặn quảng cáo.');
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError('Bạn đã đóng cửa sổ đăng nhập trước khi hoàn tất. Vui lòng thử lại.');
      } else if (err.code === 'auth/unauthorized-domain' || err.message?.includes('unauthorized-domain')) {
        setError('Tên miền này chưa được cấp phép. Admin cần thêm tên miền của trang Vercel vào "Authorized Domains" trong Firebase Console: https://console.firebase.google.com/project/seismic-honor-492901-g3/auth/providers');
      } else {
        setError(err.message || 'Lỗi đăng nhập Google');
      }
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setError('');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      if (err.code === 'auth/network-request-failed' || err.message?.includes('network-request-failed')) {
        setError('Lỗi kết nối mạng. Vui lòng thử mở ứng dụng trong tab mới (nhấn vào biểu tượng mở tab mới ở góc trên bên phải) hoặc tắt trình chặn quảng cáo.');
      } else {
        setError(err.message || 'Lỗi đăng nhập Học sinh');
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-blue-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <h2 className="mt-6 text-center text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 py-4 leading-normal">
          TOÁN THẦY TRỌNG 3T
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600 font-medium">
          Hệ thống kiểm tra học kì
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white/80 backdrop-blur-lg py-8 px-4 shadow-2xl sm:rounded-2xl sm:px-10 border border-white/50">
          {error && <div className="mb-4 p-3 bg-red-100 border-l-4 border-red-500 text-red-700 rounded-md text-sm font-medium">{error}</div>}
          
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Dành cho Giáo viên</h3>
            <button
              onClick={handleTeacherLogin}
              className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-md text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all duration-200 transform hover:-translate-y-0.5"
            >
              Đăng nhập bằng Google
            </button>
          </div>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-300" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-4 bg-white/80 text-gray-500 font-medium rounded-full">Hoặc dành cho Học sinh</span>
            </div>
          </div>

          <form className="mt-6 space-y-6" onSubmit={handleStudentLogin}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Email</label>
              <div className="mt-1">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                  placeholder="Nhập email của bạn"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Mật khẩu</label>
              <div className="mt-1">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-xl shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm transition-colors"
                  placeholder="Nhập mật khẩu"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-md text-sm font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 transition-all duration-200 transform hover:-translate-y-0.5"
              >
                Đăng nhập Học sinh
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
