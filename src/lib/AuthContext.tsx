import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

export type UserRole = 'teacher' | 'student';

export interface AppUser {
  uid: string;
  email: string;
  role: UserRole;
  name: string;
  className?: string;
  facebook?: string;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  appUser: null,
  loading: true,
  loginWithGoogle: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            setAppUser(userDoc.data() as AppUser);
          } else {
            // Check if a teacher already exists
            const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
            const querySnapshot = await getDocs(q);
            
            if (querySnapshot.empty) {
              const newUser: AppUser = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                role: 'teacher',
                name: firebaseUser.displayName || 'Giáo viên',
                createdAt: new Date().toISOString(),
              };
              await setDoc(userDocRef, newUser);
              setAppUser(newUser);
            } else {
              // Teacher already exists, and this new Google user is not in DB.
              await signOut(auth);
              setAppUser(null);
              setUser(null);
            }
          }
        } catch (error) {
          console.error("Error fetching user data:", error);
        }
      } else {
        setAppUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;
      
      const userDocRef = doc(db, 'users', firebaseUser.uid);
      const userDoc = await getDoc(userDocRef);
      
      if (!userDoc.exists()) {
        const q = query(collection(db, 'users'), where('role', '==', 'teacher'));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
          await signOut(auth);
          throw new Error('Hệ thống đã có tài khoản giáo viên. Bạn không thể đăng nhập bằng tài khoản Google khác.');
        }
      }
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, appUser, loading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
