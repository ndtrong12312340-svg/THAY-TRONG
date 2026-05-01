import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
}, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';

export async function updateStudentContactIndex(dbInstance: any, student: any) {
  try {
    const data = {
      [student.uid || student.id]: {
        id: student.uid || student.id,
        name: student.name || '',
        className: student.className || '',
        email: student.email || '',
        phone: student.phone || '',
        facebook: student.facebook || ''
      }
    };
    await setDoc(doc(dbInstance, 'admin_indexes', 'contacts_map'), data, { merge: true });
  } catch (err) {
    console.error('Error updating contacts_map index:', err);
  }
}

export async function updateStudentManagementIndex(dbInstance: any, student: any) {
  try {
    const data = {
      [student.uid || student.id]: {
        id: student.uid || student.id,
        name: student.name || '',
        className: student.className || '',
        email: student.email || '',
        password: student.password || ''
      }
    };
    await setDoc(doc(dbInstance, 'admin_indexes', 'students_map'), data, { merge: true });
  } catch (err) {
    console.error('Error updating students_map index:', err);
  }
}

export async function deleteStudentFromIndexes(dbInstance: any, studentId: string) {
  if (!studentId) return;
  // Firestore currently does not have a simple way to delete a specific key from a map via setDoc/merge.
  // We use updateDoc with deleteField().
  const { updateDoc, deleteField } = await import('firebase/firestore');
  try {
    await updateDoc(doc(dbInstance, 'admin_indexes', 'contacts_map'), {
      [studentId]: deleteField()
    });
  } catch (err) {}
  try {
    await updateDoc(doc(dbInstance, 'admin_indexes', 'students_map'), {
      [studentId]: deleteField()
    });
  } catch (err) {}
}

export async function syncGlobalStudentIndexes(dbInstance: any) {
  try {
    const q = query(collection(dbInstance, 'users'), where('role', '==', 'student'));
    const snap = await getDocs(q);
    const studentsMap: any = {};
    const contactsMap: any = {};

    snap.forEach(d => {
      const data = d.data();
      const stId = d.id;
      studentsMap[stId] = {
        id: stId,
        name: data.name || '',
        className: data.className || '',
        email: data.email || '',
        password: data.password || ''
      };
      contactsMap[stId] = {
        id: stId,
        name: data.name || '',
        className: data.className || '',
        email: data.email || '',
        phone: data.phone || '',
        facebook: data.facebook || ''
      };
    });

    await setDoc(doc(dbInstance, 'admin_indexes', 'students_map'), studentsMap);
    await setDoc(doc(dbInstance, 'admin_indexes', 'contacts_map'), contactsMap);
  } catch (err) {
    console.error('Error syncing global student indexes:', err);
  }
}
export async function syncClassExamIndexes(classesToSync: string[], dbInstance: any) {
  for (const className of classesToSync) {
    if (!className) continue;
    try {
      const q = query(
        collection(dbInstance, 'exams'),
        where('status', '==', 'published'),
        where('assignedClasses', 'array-contains', className)
      );
      const snap = await getDocs(q);
      const exams: any[] = [];
      snap.forEach(d => {
        const data = d.data();
        exams.push({
          id: d.id,
          title: data.title,
          duration: data.duration,
          startTime: data.startTime,
          endTime: data.endTime,
          status: data.status,
          teacherId: data.teacherId
        });
      });
      // Sort exams internally
      exams.sort((a, b) => {
        const matchA = (a.title || '').match(/\d+/);
        const matchB = (b.title || '').match(/\d+/);
        if (matchA && matchB) {
          const numA = parseInt(matchA[0], 10);
          const numB = parseInt(matchB[0], 10);
          if (numA !== numB) return numA - numB;
        }
        return (a.title || '').localeCompare(b.title || '');
      });
      
      await setDoc(doc(dbInstance, 'class_indexes', className), { exams });
    } catch (err) {
      console.error(`Error syncing index for class ${className}:`, err);
    }
  }
}

export async function syncStudentSubmissionIndex(studentId: string, dbInstance: any) {
  if (!studentId) return;
  try {
    const q = query(
      collection(dbInstance, 'submissions'),
      where('studentId', '==', studentId)
    );
    const snap = await getDocs(q);
    const submissions: any[] = [];
    snap.forEach(d => {
      const data = d.data();
      submissions.push({
        id: d.id,
        examId: data.examId,
        score: data.score,
        status: data.status,
        submittedAt: data.submittedAt
      });
    });
    
    await setDoc(doc(dbInstance, 'student_indexes', studentId), { submissions });
  } catch (err) {
    console.error(`Error syncing submission index for student ${studentId}:`, err);
  }
}
export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
