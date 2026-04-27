import React from 'react';
import { GraduationCap, History as HistoryIcon, User } from 'lucide-react';
import { cn } from '../lib/utils';

export const Navbar = () => {
  return (
    <nav className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-lg shadow-indigo-200">
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl font-display">
            EduQuizz
          </span>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <button className="flex items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-indigo-600">
            <HistoryIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Lịch sử</span>
          </button>
          <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
            <User className="h-5 w-5 text-slate-600" />
          </div>
        </div>
      </div>
    </nav>
  );
};
