import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Webcam from 'react-webcam';
import Papa from 'papaparse';
import { Camera, MapPin, Clock, User, Users, CheckCircle, AlertCircle, RefreshCw, FileText, Trash2, Download, Search, Calendar, Building, Flag, LogOut, LogIn, Calculator, Printer, MessageCircle } from 'lucide-react';
import { auth, db, loginWithGoogle, logout, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { collection, addDoc, query, orderBy, onSnapshot, deleteDoc, doc, getDoc, limit, where, getDocs, updateDoc } from 'firebase/firestore';

interface Employee {
  userId: string;
  userName: string;
  expectedLat?: number;
  expectedLng?: number;
}

interface SalaryData {
  basicSalary: number;
  foodDeduction: number;
  noPayDeduction: number;
  uniformsDeduction: number;
}

interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  timestamp: string;
  latitude: number | null;
  longitude: number | null;
  image: string;
  type: string;
  locationName?: string;
  isFlagged?: boolean;
  authorUid?: string;
}

interface UserProfile {
  id: string;
  email: string;
  role: string;
}

function deg2rad(deg: number) {
  return deg * (Math.PI/180);
}

function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2-lat1);
  const dLon = deg2rad(lon2-lon1);
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon/2) * Math.sin(dLon/2)
    ;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c; // Distance in km
  return d;
}

const ADMIN_EMAILS = [
  'info@acestool.com',
  'buveendra.illangage@gmail.com',
  'nelushapushpawela@gmail.com'
];

export default function App() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployeeKey, setSelectedEmployeeKey] = useState<string>('');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string>('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'terminal' | 'history' | 'summary' | 'users' | 'salary'>('terminal');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [summarySelectedEmployee, setSummarySelectedEmployee] = useState<string>('');
  
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [salaries, setSalaries] = useState<Record<string, SalaryData>>({});
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [agentData, setAgentData] = useState<any[]>([]);
  
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const webcamRef = useRef<Webcam>(null);

  const EMPLOYEES_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ5AqtIOOwuBZnyb3L7hd-11U2EoEIL8pkJyCPcT3qlPej5Y1-OGJxpKtvOdWSfVmsInZFR2SQNwU4/pub?gid=921153856&single=true&output=csv';
  const SALARY_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ5AqtIOOwuBZnyb3L7hd-11U2EoEIL8pkJyCPcT3qlPej5Y1-OGJxpKtvOdWSfVmsInZFR2SQNwU4/pub?gid=1846778885&single=true&output=csv';
  const CONTACTS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQJ5AqtIOOwuBZnyb3L7hd-11U2EoEIL8pkJyCPcT3qlPej5Y1-OGJxpKtvOdWSfVmsInZFR2SQNwU4/pub?gid=978726221&single=true&output=csv';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        // Check if admin
        if (user.email && ADMIN_EMAILS.includes(user.email) && user.emailVerified) {
          setIsAdmin(true);
        } else {
          try {
            const userDoc = await getDoc(doc(db, 'users', user.uid));
            if (userDoc.exists() && userDoc.data().role === 'admin') {
              setIsAdmin(true);
            } else {
              setIsAdmin(false);
            }
          } catch (e) {
            setIsAdmin(false);
          }
        }
      } else {
        setIsAdmin(false);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    fetchEmployees();
    getLocation();
  }, []);

  useEffect(() => {
    let unsubscribeRecords: (() => void) | undefined;
    let unsubscribeUsers: (() => void) | undefined;
    if (isAuthReady && currentUser) {
      unsubscribeRecords = fetchRecords();
      if (isAdmin) {
        unsubscribeUsers = fetchUsers();
      }
    }
    return () => {
      if (unsubscribeRecords) unsubscribeRecords();
      if (unsubscribeUsers) unsubscribeUsers();
    };
  }, [isAuthReady, currentUser, isAdmin]);

  const fetchUsers = () => {
    if (!isAdmin) return;
    try {
      const q = query(collection(db, 'users'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as UserProfile[];
        setUsers(data);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users');
      });
      return unsubscribe;
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const handleLogin = async () => {
    try {
      await loginWithGoogle();
    } catch (error: any) {
      if (error?.message?.includes('api-key-not-valid')) {
        alert("Your Firebase API key is no longer valid. Please ask the AI agent to re-run the Firebase setup.");
      } else if (error?.message?.includes('cancelled-popup-request') || error?.message?.includes('INTERNAL ASSERTION FAILED')) {
        alert("The login popup was closed, blocked by your browser, or failed. Please allow popups, or try opening the app in a new tab using the 'Open in New Tab' button in the top right.");
      } else {
        alert(`Login failed: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
  };

  const handleUpdateRole = async (userId: string, newRole: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
    } catch (error) {
      console.error("Error updating role:", error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const [locationCoords, setLocationCoords] = useState<Record<string, {lat: number, lng: number}>>({});

  const fetchEmployees = () => {
    // First fetch EMPLOYEES_CSV_URL to map user expected coordinates
    Papa.parse(EMPLOYEES_CSV_URL, {
      download: true,
      header: true,
      complete: (empResults) => {
        const userCoords: Record<string, {lat: number, lng: number}> = {};
        empResults.data.forEach((row: any) => {
          const userId = row['XG_NO'];
          const geoCode = row['GEO_CODE'];
          if (userId && geoCode) {
            const match = geoCode.match(/Latitude:\s*([\d.-]+)[^\d]*Longitude:\s*([\d.-]+)/i);
            if (match) {
              userCoords[userId] = {
                lat: parseFloat(match[1]),
                lng: parseFloat(match[2])
              };
            }
          }
        });

        // Then fetch SALARY_CSV_URL for employees and salary data
        Papa.parse(SALARY_CSV_URL, {
          download: true,
          header: true,
          complete: (results) => {
            const parsedEmployees: Employee[] = [];
            const seenIds = new Set();
            const extractedLocations = new Set<string>();

            setAgentData(results.data);
            const newSalaries: Record<string, SalaryData> = {};

            results.data.forEach((row: any) => {
              const userId = row['XGID'];
              // Fallbacks for header names
              const userName = row['Name'] || row['NAME'];
              const point = row['POINT'] || row['POINT '];

              if (userId && userName && !seenIds.has(userId)) {
                seenIds.add(userId);
                const coords = userCoords[userId];
                parsedEmployees.push({
                  userId: userId,
                  userName: userName,
                  expectedLat: coords?.lat,
                  expectedLng: coords?.lng
                });
              }

              if (point) {
                extractedLocations.add(point.trim());
              }

              if (userId) {
                newSalaries[userId] = {
                  basicSalary: parseFloat(row['BASIC SALARY ']) || 0,
                  foodDeduction: parseFloat(row['MEAL ']) || 0,
                  noPayDeduction: parseFloat(row['NO PAY']) || 0,
                  uniformsDeduction: parseFloat(row['UNIFORM']) || 0
                };
              }
            });

            // Add dynamically parsed unique locations
            const sortedLocations = Array.from(extractedLocations)
              .filter(Boolean)
              .sort() as string[];
            setLocations(sortedLocations);
            if (sortedLocations.length > 0) {
              setSelectedLocation(sortedLocations[0]);
            }

            setEmployees(parsedEmployees);
            setSalaries(newSalaries);
            setIsLoading(false);
          },
          error: (error) => {
            console.error('Error parsing Salary CSV:', error);
            setIsLoading(false);
          }
        });
      },
      error: (error) => {
        console.error('Error parsing Employee CSV:', error);
        setIsLoading(false);
      }
    });

    Papa.parse(CONTACTS_CSV_URL, {
      download: true,
      header: true,
      complete: (results) => {
        const newContacts: Record<string, string> = {};
        results.data.forEach((row: any) => {
          const userId = row['XGNO'];
          const contact = row['CONTACT NO'];
          if (userId && contact) {
            // Remove non-numeric characters just in case, but usually WhatsApp expects +947... etc
            newContacts[userId] = contact.replace(/[^0-9+]/g, '');
          }
        });
        setContacts(newContacts);
      },
      error: (error) => {
        console.error('Error parsing Contacts CSV:', error);
      }
    });
  };

  const fetchRecords = () => {
    if (!currentUser) return;
    try {
      let q;
      if (isAdmin) {
        q = query(collection(db, 'attendance'), orderBy('timestamp', 'desc'));
      } else {
        q = query(collection(db, 'attendance'), where('authorUid', '==', currentUser.uid), orderBy('timestamp', 'desc'));
      }
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as AttendanceRecord[];
        setRecords(data);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'attendance');
      });
      
      return unsubscribe;
    } catch (error) {
      console.error('Error fetching records:', error);
    }
  };

  const getLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
          setLocationError('');
        },
        (error) => {
          console.error('Error getting location:', error);
          setLocationError('Unable to retrieve your location. Please ensure location services are enabled.');
        }
      );
    } else {
      setLocationError('Geolocation is not supported by your browser.');
    }
  };

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    return imageSrc;
  }, [webcamRef]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!currentUser) {
      setSubmitMessage({ text: 'You must be logged in to record attendance.', type: 'error' });
      return;
    }

    if (!selectedEmployeeKey) {
      setSubmitMessage({ text: 'Please select an employee.', type: 'error' });
      return;
    }

    if (!selectedLocation) {
      setSubmitMessage({ text: 'Please select a location.', type: 'error' });
      return;
    }

    let imageSrc = uploadedImage;
    if (!imageSrc) {
      imageSrc = capture() || null;
    }
    
    if (!imageSrc) {
      setSubmitMessage({ text: 'Failed to capture or upload image. Please ensure camera is accessible or upload a photo.', type: 'error' });
      return;
    }

    setIsSubmitting(true);
    setSubmitMessage(null);

    const [selectedUserId, ...nameParts] = selectedEmployeeKey.split('-');
    const selectedUserName = nameParts.join('-');
    
    let isFlagged = false;
    const employee = employees.find(e => e.userId === selectedUserId);
    
    if (employee && employee.expectedLat && employee.expectedLng) {
      if (location) {
        const distance = getDistanceFromLatLonInKm(
          location.latitude,
          location.longitude,
          employee.expectedLat,
          employee.expectedLng
        );
        // 100 meters is 0.1 km
        if (distance > 0.1) {
          isFlagged = true;
        }
      } else {
        isFlagged = true; // Flag if required location is not provided
      }
    } else {
      // If we don't have expected coordinates for this user, flag them just in case (or don't flag them).
      // We will flag them to indicate their profile is incomplete.
      isFlagged = true;
    }
    
    try {
      // Determine Time In or Time Out
      let type = 'Time In';
      let hoursWorked: string | null = null;
      const timestamp = new Date().toISOString();

      const lastRecord = records.find(r => r.userId === selectedUserId);

      if (lastRecord && lastRecord.type === 'Time In') {
        type = 'Time Out';
        const inTime = new Date(lastRecord.timestamp).getTime();
        const outTime = new Date(timestamp).getTime();
        const diffHrs = (outTime - inTime) / (1000 * 60 * 60);
        hoursWorked = diffHrs.toFixed(2);
      }

      const newRecord = {
        userId: selectedUserId,
        userName: selectedUserName || 'Unknown',
        timestamp,
        latitude: location?.latitude || null,
        longitude: location?.longitude || null,
        image: imageSrc,
        type,
        locationName: selectedLocation,
        isFlagged,
        authorUid: currentUser.uid
      };

      const docRef = await addDoc(collection(db, 'attendance'), newRecord);

      // Call webhook
      let webhookError = null;
      const webhookUrl = '/api/webhook';
      
      try {
        const webhookRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            seqId: docRef.id,
            ...newRecord,
            hoursWorked
          })
        });
        
        const responseText = await webhookRes.text();
        try {
          const parsed = JSON.parse(responseText);
          if (parsed.status === "error") {
            webhookError = parsed.message;
          }
        } catch (e) {
          if (!webhookRes.ok) {
            webhookError = `HTTP ${webhookRes.status}: ${responseText.substring(0, 100)}`;
          }
        }
      } catch (err: any) {
        console.error("Error forwarding to Google Sheets webhook:", err);
        webhookError = err.message || "Network error reaching webhook";
      }
      
      let msg = `Attendance captured and sheets updated successfully! (Token ID: ${docRef.id.substring(0, 8).toUpperCase()})`;
      if (isFlagged) {
        msg = `Attendance captured and sheets updated successfully - FLAGGED for location variance! (Token ID: ${docRef.id.substring(0, 8).toUpperCase()})`;
      }
      if (webhookError) {
        msg = `Successfully recorded ${type} locally! (Google Sheet Sync Error: ${webhookError})`;
      }
      setSubmitMessage({ text: msg, type: webhookError ? 'error' : 'success' });
      setSelectedEmployeeKey(''); // Reset selection
      setUploadedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
    } catch (error) {
      console.error('Error submitting attendance:', error);
      try {
        handleFirestoreError(error, OperationType.CREATE, 'attendance');
      } catch (e) {
        // Ignored
      }
      setSubmitMessage({ text: 'Network error or permission denied. Please check your connection and account.', type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'attendance', id));
    } catch (error) {
      console.error('Error deleting record:', error);
      handleFirestoreError(error, OperationType.DELETE, `attendance/${id}`);
    } finally {
      setDeleteConfirmId(null);
    }
  };

  const handleClearAll = async () => {
    try {
      // In Firestore, we have to delete documents one by one
      const snapshot = await getDocs(collection(db, 'attendance'));
      const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Error clearing records:', error);
      handleFirestoreError(error, OperationType.DELETE, 'attendance');
    } finally {
      setShowClearConfirm(false);
    }
  };

  const exportCSV = () => {
    const headers = ['ID', 'User ID', 'Name', 'Type', 'Location', 'Timestamp', 'Latitude', 'Longitude', 'Flagged'];
    const csvContent = [
      headers.join(','),
      ...filteredRecords.map(r => 
        `${r.id},${r.userId},"${r.userName}",${r.type},"${r.locationName || ''}",${r.timestamp},${r.latitude || ''},${r.longitude || ''},${r.isFlagged ? 'Yes' : 'No'}`
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `attendance_report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.userName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          record.userId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDate = dateFilter ? record.timestamp.startsWith(dateFilter) : true;
    return matchesSearch && matchesDate;
  });

  const summaryRecords = useMemo(() => {
    const map = new Map<string, {
      userId: string;
      userName: string;
      date: string;
      timeIn: string | null;
      timeOut: string | null;
      hoursWorked: string | null;
      inLat: number | null;
      inLng: number | null;
      outLat: number | null;
      outLng: number | null;
    }>();

    // Sort records oldest first to process chronologically
    const sortedRecords = [...records].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    sortedRecords.forEach(record => {
      // A day starts at 7am and ends at 7am the next day.
      // Subtract 7 hours from the timestamp to align with calendar date grouping logic.
      const dateObj = new Date(record.timestamp);
      const logicalDateObj = new Date(dateObj.getTime() - 7 * 60 * 60 * 1000);
      const dateStr = `${logicalDateObj.getFullYear()}-${String(logicalDateObj.getMonth() + 1).padStart(2, '0')}-${String(logicalDateObj.getDate()).padStart(2, '0')}`;
      const key = `${record.userId}-${dateStr}`;

      if (!map.has(key)) {
        map.set(key, {
          userId: record.userId,
          userName: record.userName,
          date: dateStr,
          timeIn: null,
          timeOut: null,
          hoursWorked: null,
          inLat: null,
          inLng: null,
          outLat: null,
          outLng: null
        });
      }

      const summary = map.get(key)!;
      if (record.type === 'Time In') {
        if (!summary.timeIn) {
          summary.timeIn = record.timestamp;
          summary.inLat = record.latitude;
          summary.inLng = record.longitude;
        }
      } else if (record.type === 'Time Out') {
        summary.timeOut = record.timestamp;
        summary.outLat = record.latitude;
        summary.outLng = record.longitude;
      }
    });

    Array.from(map.values()).forEach(summary => {
      if (summary.timeIn && summary.timeOut) {
        const inTime = new Date(summary.timeIn).getTime();
        const outTime = new Date(summary.timeOut).getTime();
        const diffHrs = (outTime - inTime) / (1000 * 60 * 60);
        summary.hoursWorked = diffHrs.toFixed(2);
      }
    });

    // Sort by date descending
    return Array.from(map.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [records]);

  const filteredSummaryRecords = summaryRecords.filter(record => {
    const matchesSearch = record.userName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          record.userId.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDate = dateFilter ? record.date === dateFilter : true;
    return matchesSearch && matchesDate;
  });

  const updateSalaryData = (userId: string, field: keyof SalaryData, value: number) => {
    setSalaries(prev => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || { basicSalary: 0, foodDeduction: 0, noPayDeduction: 0, uniformsDeduction: 0 }),
        [field]: value
      }
    }));
  };

  const calculateSalary = (data: SalaryData | undefined) => {
    if (!data) return { epf8: 0, totalDeductions: 0, netPay: 0, epf12: 0, etf3: 0 };
    const epf8 = data.basicSalary * 0.08;
    const totalDeductions = epf8 + data.foodDeduction + data.noPayDeduction + data.uniformsDeduction;
    const netPay = data.basicSalary - totalDeductions;
    const epf12 = data.basicSalary * 0.12;
    const etf3 = data.basicSalary * 0.03;
    return { epf8, totalDeductions, netPay, epf12, etf3 };
  };

  const handleWhatsAppShare = (employee: Employee, data: SalaryData | undefined) => {
    const contact = contacts[employee.userId];
    if (!contact) {
      alert(`No contact number found for ${employee.userName} (${employee.userId}) in the contacts sheet.`);
      return;
    }
    const calc = calculateSalary(data);
    const message = `Pay Sheet - ${employee.userName} (${employee.userId})
----------------------------------------
Basic Salary: Rs. ${data?.basicSalary?.toFixed(2) || '0.00'}
Meals: Rs. ${data?.foodDeduction?.toFixed(2) || '0.00'}
No Pay: Rs. ${data?.noPayDeduction?.toFixed(2) || '0.00'}
Uniform: Rs. ${data?.uniformsDeduction?.toFixed(2) || '0.00'}
EPF 8%: Rs. ${calc.epf8.toFixed(2)}
Total Deductions: Rs. ${calc.totalDeductions.toFixed(2)}
----------------------------------------
Net Pay: Rs. ${calc.netPay.toFixed(2)}
----------------------------------------
Company Contributions:
EPF 12%: Rs. ${calc.epf12.toFixed(2)}
ETF 3%: Rs. ${calc.etf3.toFixed(2)}
----------------------------------------`;
    
    // Ensure contact starts with country code if not present. Assuming Sri Lanka (+94)
    let formattedContact = contact;
    if (formattedContact.startsWith('0')) {
      formattedContact = '94' + formattedContact.substring(1);
    } else if (!formattedContact.startsWith('94') && !formattedContact.startsWith('+')) {
      formattedContact = '94' + formattedContact;
    }
    
    const whatsappUrl = `https://wa.me/${formattedContact}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
  };

  const handlePrintSalary = (employee: Employee, data: SalaryData | undefined) => {
    const calc = calculateSalary(data);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Pay Sheet - ${employee.userName}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .header { text-align: center; margin-bottom: 30px; }
            .total { font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>X Guard Security Services</h2>
            <h3>Pay Sheet</h3>
          </div>
          <p><strong>Employee Name:</strong> ${employee.userName}</p>
          <p><strong>XG ID:</strong> ${employee.userId}</p>
          <table>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
            <tr><td>Basic Salary</td><td>${data?.basicSalary || 0}</td></tr>
            <tr><td>8% EPF Deduction</td><td>${calc.epf8.toFixed(2)}</td></tr>
            <tr><td>Food Deduction</td><td>${data?.foodDeduction || 0}</td></tr>
            <tr><td>No Pay Deduction</td><td>${data?.noPayDeduction || 0}</td></tr>
            <tr><td>Uniforms Deduction</td><td>${data?.uniformsDeduction || 0}</td></tr>
            <tr class="total"><td>Net Pay</td><td>${calc.netPay.toFixed(2)}</td></tr>
          </table>
          <h4 style="margin-top: 30px;">Company Contributions</h4>
          <table>
            <tr><th>Description</th><th>Amount (LKR)</th></tr>
            <tr><td>12% EPF</td><td>${calc.epf12.toFixed(2)}</td></tr>
            <tr><td>3% ETF</td><td>${calc.etf3.toFixed(2)}</td></tr>
          </table>
          <script>
            window.onload = () => { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleWhatsAppSalary = (employee: Employee, data: SalaryData | undefined) => {
    const calc = calculateSalary(data);
    const message = `*X Guard Security Services - Pay Sheet*
Name: ${employee.userName}
XG ID: ${employee.userId}

*Earnings*
Basic Salary: LKR ${data?.basicSalary || 0}

*Deductions*
8% EPF: LKR ${calc.epf8.toFixed(2)}
Food: LKR ${data?.foodDeduction || 0}
No Pay: LKR ${data?.noPayDeduction || 0}
Uniforms: LKR ${data?.uniformsDeduction || 0}

*Net Pay: LKR ${calc.netPay.toFixed(2)}*

*Company Contributions*
12% EPF: LKR ${calc.epf12.toFixed(2)}
3% ETF: LKR ${calc.etf3.toFixed(2)}`;

    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  return (
    <>
      <div className="cosmic-bg"></div>
      <div className="min-h-screen p-4 md:p-8 font-sans relative z-10">
        <div className="max-w-6xl mx-auto space-y-8">
          <header className="text-center space-y-4 relative">
            <div className="absolute top-0 right-0">
              {currentUser ? (
                <div className="flex items-center space-x-4">
                  <span className="text-sm text-yellow-600/80 hidden sm:inline-block">
                    {currentUser.email} {isAdmin && <span className="ml-2 px-2 py-0.5 bg-yellow-500/20 text-yellow-500 rounded-full text-xs font-bold">ADMIN</span>}
                  </span>
                  <button
                    onClick={logout}
                    className="flex items-center px-3 py-1.5 text-sm font-medium text-yellow-600/80 hover:text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors border border-yellow-500/20"
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleLogin}
                  className="flex items-center px-4 py-2 text-sm font-medium text-black bg-yellow-500 hover:bg-yellow-400 rounded-lg transition-colors shadow-lg shadow-yellow-500/20"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In
                </button>
              )}
            </div>
            <img src="https://i.imgur.com/Oo9l0FN.png" alt="Logo" className="h-20 mx-auto object-contain drop-shadow-lg" referrerPolicy="no-referrer" />
            <h1 className="text-3xl font-bold text-yellow-400 tracking-tight">Attendance Terminal</h1>
            <p className="text-yellow-600/80 font-medium">X Guard Security Services</p>
          </header>

          <div className="flex justify-center">
            <div className="flex space-x-1 bg-black/40 backdrop-blur-md p-1 rounded-xl w-fit border border-yellow-500/20">
              <button
                onClick={() => setActiveTab('terminal')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center ${activeTab === 'terminal' ? 'bg-yellow-500 text-black shadow-sm' : 'text-yellow-400 hover:text-yellow-300 hover:bg-white/5'}`}
              >
                <Camera className="w-4 h-4 mr-2" />
                Terminal
              </button>
              {isAdmin && (
                <>
                  <button
                    onClick={() => setActiveTab('history')}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center ${activeTab === 'history' ? 'bg-yellow-500 text-black shadow-sm' : 'text-yellow-400 hover:text-yellow-300 hover:bg-white/5'}`}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    History
                  </button>
                  <button
                    onClick={() => setActiveTab('summary')}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center ${activeTab === 'summary' ? 'bg-yellow-500 text-black shadow-sm' : 'text-yellow-400 hover:text-yellow-300 hover:bg-white/5'}`}
                  >
                    <Clock className="w-4 h-4 mr-2" />
                    Summary / Salary
                  </button>
                  <button
                    onClick={() => setActiveTab('users')}
                    className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors flex items-center ${activeTab === 'users' ? 'bg-yellow-500 text-black shadow-sm' : 'text-yellow-400 hover:text-yellow-300 hover:bg-white/5'}`}
                  >
                    <Users className="w-4 h-4 mr-2" />
                    Users
                  </button>
                </>
              )}
            </div>
          </div>

          {isAdmin && (
            <div className="flex justify-center gap-4 flex-wrap">
              <a 
                href={EMPLOYEES_CSV_URL}
                target="_blank" rel="noreferrer"
                className="text-xs px-4 py-2 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 transition-colors flex items-center"
              >
                <FileText className="w-4 h-4 mr-2" /> Employee Data CSV
              </a>
              <a 
                href={SALARY_CSV_URL}
                target="_blank" rel="noreferrer"
                className="text-xs px-4 py-2 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/20 transition-colors flex items-center"
              >
                <FileText className="w-4 h-4 mr-2" /> Salary Data CSV
              </a>
              <a 
                href="https://docs.google.com/spreadsheets/u/0/"
                target="_blank" rel="noreferrer"
                className="text-xs px-4 py-2 bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-colors flex items-center"
                title="Go to Google Sheets to view the destination data"
              >
                <Download className="w-4 h-4 mr-2" /> View Saved Data Sheet
              </a>
            </div>
          )}

          {activeTab === 'terminal' ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Main Action Panel */}
              <div className="lg:col-span-1 space-y-6">
              <div className="bg-black/60 backdrop-blur-md rounded-2xl shadow-xl border border-yellow-500/30 p-6 space-y-6">
                <div className="space-y-4">
                  <div>
                    <label htmlFor="location-select" className="block text-sm font-medium text-yellow-400 mb-1">
                      Select Location
                    </label>
                    <select
                      id="location-select"
                      className="w-full rounded-xl border-yellow-500/30 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 bg-black/50 p-3 border text-yellow-100 mb-4"
                      value={selectedLocation}
                      onChange={(e) => setSelectedLocation(e.target.value)}
                    >
                      <option value="">-- Select Location --</option>
                      {locations.map((loc, idx) => (
                        <option key={idx} value={loc}>{loc}</option>
                      ))}
                    </select>

                    <label htmlFor="user-select" className="block text-sm font-medium text-yellow-400 mb-1">
                      Search & Select Employee
                    </label>
                    {isLoading ? (
                      <div className="flex items-center text-yellow-600/70 text-sm">
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        Loading employees...
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                          <input 
                            type="text" 
                            placeholder="Type to search agent..." 
                            value={employeeSearchQuery}
                            onChange={(e) => setEmployeeSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100 placeholder:text-yellow-600/50"
                          />
                        </div>
                        <select
                          id="user-select"
                          className="w-full rounded-xl border-yellow-500/30 shadow-sm focus:border-yellow-500 focus:ring-yellow-500 bg-black/50 p-3 border text-yellow-100"
                          value={selectedEmployeeKey}
                          onChange={(e) => setSelectedEmployeeKey(e.target.value)}
                        >
                          <option value="">-- Select your ID --</option>
                          {employees
                            .filter(emp => 
                              emp.userName.toLowerCase().includes(employeeSearchQuery.toLowerCase()) || 
                              emp.userId.toLowerCase().includes(employeeSearchQuery.toLowerCase())
                            )
                            .map((emp, index) => {
                            const uniqueKey = `${emp.userId}-${emp.userName}`;
                            return (
                              <option key={`${uniqueKey}-${index}`} value={uniqueKey}>
                                {emp.userId} - {emp.userName}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl overflow-hidden bg-black aspect-video relative border border-yellow-500/20">
                    {uploadedImage ? (
                      <div className="relative w-full h-full">
                        <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-cover" />
                        <button
                          onClick={() => setUploadedImage(null)}
                          className="absolute top-2 right-2 bg-black/60 p-2 rounded-full text-white hover:bg-black/80 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Webcam
                          audio={false}
                          ref={webcamRef}
                          screenshotFormat="image/jpeg"
                          screenshotQuality={0.7}
                          videoConstraints={{ facingMode: "user" }}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center text-yellow-100/80 text-xs">
                          <div className="flex items-center bg-black/60 px-2 py-1 rounded-md backdrop-blur-sm border border-yellow-500/20">
                            <Camera className="w-3 h-3 mr-1 text-yellow-400" /> Camera Active
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex justify-center">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-sm text-yellow-500 hover:text-yellow-400 transition-colors flex items-center"
                    >
                      <Camera className="w-4 h-4 mr-2" />
                      Or upload a photo / screenshot
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center text-sm text-yellow-100/70">
                      <MapPin className="w-4 h-4 mr-2 text-yellow-500" />
                      {location ? (
                        <span>Location acquired</span>
                      ) : locationError ? (
                        <span className="text-red-400">{locationError}</span>
                      ) : (
                        <span className="flex items-center">
                          <RefreshCw className="w-3 h-3 animate-spin mr-2" /> Acquiring location...
                        </span>
                      )}
                    </div>
                    <div className="flex items-center text-sm text-yellow-100/70">
                      <Clock className="w-4 h-4 mr-2 text-yellow-500" />
                      <span>{new Date().toLocaleTimeString()}</span>
                    </div>
                  </div>

                  {submitMessage && (
                    <div className={`p-3 rounded-xl text-sm flex items-start border ${submitMessage.type === 'success' ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/30' : 'bg-red-950/50 text-red-400 border-red-500/30'}`}>
                      {submitMessage.type === 'success' ? (
                        <CheckCircle className="w-5 h-5 mr-2 shrink-0" />
                      ) : (
                        <AlertCircle className="w-5 h-5 mr-2 shrink-0" />
                      )}
                      {submitMessage.text}
                    </div>
                  )}

                  <div className="flex space-x-3">
                    <button
                      onClick={handleSubmit}
                      disabled={isSubmitting || !selectedEmployeeKey}
                      className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center shadow-[0_0_15px_rgba(234,179,8,0.3)]"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
                          Processing...
                        </>
                      ) : (
                        'Record Attendance'
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedEmployeeKey('');
                        setEmployeeSearchQuery('');
                        setUploadedImage(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      disabled={isSubmitting || (!selectedEmployeeKey && !employeeSearchQuery && !uploadedImage)}
                      className="px-4 py-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center border border-neutral-700"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            </div>

          {/* History Panel */}
          <div className="lg:col-span-2">
            <div className="bg-black/60 backdrop-blur-md rounded-2xl shadow-xl border border-yellow-500/30 overflow-hidden h-full flex flex-col">
              <div className="p-6 border-b border-yellow-500/20 flex justify-between items-center bg-black/40">
                <h2 className="text-lg font-semibold text-yellow-400 flex items-center">
                  <Clock className="w-5 h-5 mr-2 text-yellow-500" />
                  Recent Activity
                </h2>
                <button 
                  onClick={fetchRecords}
                  className="p-2 text-yellow-600/70 hover:text-yellow-400 hover:bg-white/5 rounded-lg transition-colors"
                  title="Refresh History"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>
              
              <div className="p-0 overflow-auto flex-1 max-h-[600px]">
                {records.length === 0 ? (
                  <div className="p-8 text-center text-yellow-600/50">
                    No attendance records found.
                  </div>
                ) : (
                  <div className="divide-y divide-yellow-500/10">
                    {records.map((record) => (
                      <div key={record.id} className="p-4 hover:bg-white/5 transition-colors flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                        <div className="shrink-0">
                          <img 
                            src={record.image} 
                            alt={`Attendance photo of ${record.userName}`} 
                            className="w-16 h-16 rounded-lg object-cover border border-yellow-500/30 shadow-sm"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <h3 className={`text-sm font-medium truncate flex items-center gap-2 ${record.isFlagged ? 'text-red-400' : 'text-yellow-100'}`}>
                              {record.userName}
                              {!!record.isFlagged && (
                                <span title="Location mismatch (>1km from expected)" className="text-red-500">
                                  <Flag className="w-3 h-3" />
                                </span>
                              )}
                            </h3>
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                              record.type === 'Time In' ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/30' : 'bg-amber-950/50 text-amber-400 border-amber-500/30'
                            }`}>
                              {record.type || 'Time In'}
                            </span>
                          </div>
                          <div className="text-xs text-yellow-600/70 space-y-1">
                            <div className="flex items-center">
                              <User className="w-3 h-3 mr-1" /> {record.userId}
                            </div>
                            <div className="flex items-center">
                              <Clock className="w-3 h-3 mr-1" /> {new Date(record.timestamp).toLocaleString()}
                            </div>
                            {record.locationName && (
                              <div className="flex items-center">
                                <Building className="w-3 h-3 mr-1" /> {record.locationName}
                              </div>
                            )}
                            {(record.latitude && record.longitude) && (
                              <div className="flex items-center">
                                <MapPin className="w-3 h-3 mr-1" /> 
                                {record.latitude.toFixed(4)}, {record.longitude.toFixed(4)}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
          ) : activeTab === 'history' ? (
          <div className="bg-black/60 backdrop-blur-md rounded-2xl shadow-xl border border-yellow-500/30 overflow-hidden flex flex-col min-h-[600px]">
            <div className="p-6 border-b border-yellow-500/20 bg-black/40 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-xl font-semibold text-yellow-400 flex items-center">
                  <FileText className="w-6 h-6 mr-2 text-yellow-500" />
                  Attendance History
                </h2>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={fetchRecords}
                    className="p-2 text-yellow-600/70 hover:text-yellow-400 hover:bg-white/5 rounded-lg transition-colors flex items-center"
                    title="Refresh History"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                  </button>
                  <button 
                    onClick={exportCSV}
                    className="px-4 py-2 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/30 rounded-lg transition-colors flex items-center text-sm font-medium"
                  >
                    <Download className="w-4 h-4 mr-2" /> Export CSV
                  </button>
                  <button 
                    onClick={() => setShowClearConfirm(true)}
                    className="px-4 py-2 bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/30 rounded-lg transition-colors flex items-center text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4 mr-2" /> Clear All
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                  <input 
                    type="text" 
                    placeholder="Search by name or ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100 placeholder:text-yellow-600/50"
                  />
                </div>
                <div className="relative sm:w-48">
                  <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                  <input 
                    type="date" 
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100"
                  />
                </div>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-black/40 border-b border-yellow-500/20 text-xs uppercase tracking-wider text-yellow-600/80">
                    <th className="p-4 font-medium">Seq #</th>
                    <th className="p-4 font-medium">Employee</th>
                    <th className="p-4 font-medium">Type</th>
                    <th className="p-4 font-medium">Time & Location</th>
                    <th className="p-4 font-medium">Location Status</th>
                    <th className="p-4 font-medium">Photo</th>
                    <th className="p-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-yellow-500/10">
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-yellow-600/50">
                        No records found matching your criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((record) => (
                      <tr key={record.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 text-yellow-100/80 font-mono text-sm">
                          #{record.id}
                        </td>
                        <td className="p-4">
                          <div className={`font-medium flex items-center gap-2 ${record.isFlagged ? 'text-red-400' : 'text-yellow-100'}`}>
                            {record.userName}
                            {!!record.isFlagged && (
                              <span title="Location mismatch (>1km from expected)" className="text-red-500 flex items-center">
                                <Flag className="w-4 h-4" />
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-yellow-600/70 mt-0.5">{record.userId}</div>
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                            record.type === 'Time In' ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/30' : 'bg-amber-950/50 text-amber-400 border-amber-500/30'
                          }`}>
                            {record.type || 'Time In'}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="text-sm text-yellow-100/80">{new Date(record.timestamp).toLocaleString()}</div>
                          {record.locationName && (
                            <div className="text-xs text-yellow-500 mt-0.5 flex items-center font-medium">
                              <Building className="w-3 h-3 mr-1" />
                              {record.locationName}
                            </div>
                          )}
                          {(record.latitude && record.longitude) && (
                            <div className="text-xs text-yellow-600/70 mt-0.5 flex items-center">
                              <MapPin className="w-3 h-3 mr-1" />
                              {record.latitude.toFixed(4)}, {record.longitude.toFixed(4)}
                            </div>
                          )}
                        </td>
                        <td className="p-4">
                          {record.isFlagged ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-red-950/50 text-red-400 border-red-500/30">
                              Error (Out of Range)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border bg-emerald-950/50 text-emerald-400 border-emerald-500/30">
                              Compliant
                            </span>
                          )}
                        </td>
                        <td className="p-4">
                          <img 
                            src={record.image} 
                            alt="Attendance" 
                            className="w-12 h-12 rounded-lg object-cover border border-yellow-500/30"
                          />
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => setDeleteConfirmId(record.id)}
                            className="p-2 text-yellow-600/50 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
                            title="Delete Record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          ) : activeTab === 'summary' ? (
          <div className="bg-black/60 backdrop-blur-md rounded-2xl shadow-xl border border-yellow-500/30 overflow-hidden flex flex-col min-h-[600px]">
            <div className="p-6 border-b border-yellow-500/20 bg-black/40 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h2 className="text-xl font-semibold text-yellow-400 flex items-center">
                  <Clock className="w-6 h-6 mr-2 text-yellow-500" />
                  Agent Summary & Salary
                </h2>
                <div className="flex items-center gap-2">
                  {summarySelectedEmployee && (
                    <>
                      <button 
                        onClick={() => handleWhatsAppShare(
                          employees.find(e => e.userId === summarySelectedEmployee) || { userId: summarySelectedEmployee, userName: 'Unknown' },
                          salaries[summarySelectedEmployee]
                        )}
                        className="px-4 py-2 bg-green-500/10 text-green-500 border border-green-500/30 hover:bg-green-500/20 rounded-lg transition-colors flex items-center text-sm font-medium"
                        title="Send via WhatsApp Web"
                      >
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                        WhatsApp
                      </button>
                      <button 
                        onClick={() => handlePrintSalary(
                          employees.find(e => e.userId === summarySelectedEmployee) || { userId: summarySelectedEmployee, userName: 'Unknown' },
                          salaries[summarySelectedEmployee]
                        )}
                        className="px-4 py-2 bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/20 rounded-lg transition-colors flex items-center text-sm font-medium"
                        title="Print Pay Sheet"
                      >
                        <Download className="w-4 h-4 mr-2" /> Print Sheet
                      </button>
                    </>
                  )}
                  <button 
                    onClick={fetchRecords}
                    className="p-2 text-yellow-600/70 hover:text-yellow-400 hover:bg-white/5 rounded-lg transition-colors flex items-center"
                    title="Refresh Summary"
                  >
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                  </button>
                </div>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="relative flex-1">
                  <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                  <select
                    value={summarySelectedEmployee}
                    onChange={(e) => setSummarySelectedEmployee(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100 appearance-none bg-no-repeat bg-[right_1rem_center] bg-[length:1em_1em]"
                    style={{ backgroundImage: "url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23eab308%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')" }}
                  >
                    <option value="">-- View All General Summary --</option>
                    {employees.map((emp, index) => (
                      <option key={`${emp.userId}-${index}`} value={emp.userId}>
                        {emp.userId} - {emp.userName}
                      </option>
                    ))}
                  </select>
                </div>
                {!summarySelectedEmployee && (
                  <>
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                      <input 
                        type="text" 
                        placeholder="Search by name or ID..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100 placeholder:text-yellow-600/50"
                      />
                    </div>
                    <div className="relative sm:w-48">
                      <Calendar className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-yellow-600/70" />
                      <input 
                        type="date" 
                        value={dateFilter}
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 rounded-xl border border-yellow-500/30 focus:border-yellow-500 focus:ring-yellow-500 text-sm bg-black/50 text-yellow-100"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
            
            {summarySelectedEmployee ? (
              <div className="flex flex-col lg:flex-row p-6 gap-8">
                {/* Agent Personal Timeline */}
                <div className="flex-1 space-y-4">
                  <h3 className="text-lg font-medium text-yellow-100 border-b border-yellow-500/20 pb-2">Shift History</h3>
                  <div className="overflow-x-auto border border-yellow-500/20 rounded-xl">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-black/40 border-b border-yellow-500/20 text-xs uppercase tracking-wider text-yellow-600/80">
                          <th className="p-3 font-medium">Date</th>
                          <th className="p-3 font-medium">Shift</th>
                          <th className="p-3 font-medium">Time In/Out</th>
                          <th className="p-3 font-medium text-right">Hrs</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-yellow-500/10">
                        {summaryRecords.filter(r => r.userId === summarySelectedEmployee).length === 0 ? (
                          <tr><td colSpan={4} className="p-4 text-center text-yellow-600/50">No shifts recorded</td></tr>
                        ) : (
                          summaryRecords.filter(r => r.userId === summarySelectedEmployee).map((record) => {
                            const inDate = record.timeIn ? new Date(record.timeIn) : null;
                            const isNight = inDate && (inDate.getHours() >= 18 || inDate.getHours() < 6);
                            return (
                            <tr key={record.date} className="hover:bg-white/5 transition-colors text-sm">
                              <td className="p-3 text-yellow-100/80 font-medium">{record.date}</td>
                              <td className="p-3">
                                {isNight ? (
                                  <span className="text-indigo-400 border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 rounded-full text-xs">Night</span>
                                ) : (
                                  <span className="text-amber-400 border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 rounded-full text-xs">Day</span>
                                )}
                              </td>
                              <td className="p-3 text-yellow-100/60 whitespace-nowrap">
                                <span className={record.timeIn ? "text-emerald-400" : ""}>{record.timeIn ? new Date(record.timeIn).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--'}</span> 
                                <span className="mx-1 text-yellow-500/30">-</span> 
                                <span className={record.timeOut ? "text-amber-400" : ""}>{record.timeOut ? new Date(record.timeOut).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Active'}</span>
                              </td>
                              <td className="p-3 text-right">
                                {record.hoursWorked ? (
                                  <span className="inline-flex py-0.5 px-2 rounded font-mono text-yellow-400 bg-yellow-500/10">{record.hoursWorked}h</span>
                                ) : '-'}
                              </td>
                            </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Salary Calculation */}
                <div className="flex-1 space-y-4 shadow-xl">
                  <h3 className="text-lg font-medium text-yellow-100 border-b border-yellow-500/20 pb-2">Paysheet Calculation</h3>
                  {(() => {
                    const id = summarySelectedEmployee;
                    const sd = salaries[id];
                    const adata = agentData.find(a => a['XGID'] === id);
                    if (!sd && !adata) return <div className="text-yellow-600/50 text-sm">No matched data in Salary CSV for this agent.</div>;
                    
                    const calc = calculateSalary({
                      basicSalary: sd?.basicSalary || parseFloat(adata?.['BASIC SALARY '] || 0),
                      foodDeduction: sd?.foodDeduction || parseFloat(adata?.['MEAL '] || 0),
                      noPayDeduction: sd?.noPayDeduction || parseFloat(adata?.['NO PAY'] || 0),
                      uniformsDeduction: sd?.uniformsDeduction || parseFloat(adata?.['UNIFORM'] || 0)
                    });

                    return (
                      <div className="bg-black/40 rounded-xl p-5 border border-yellow-500/20 text-sm space-y-4 text-yellow-100/80">
                        <div className="grid grid-cols-2 gap-4">
                          <div><span className="block text-yellow-600/70 text-xs uppercase mb-1 flex items-center"><MapPin className="w-3 h-3 mr-1"/> Location Point</span><div className="font-medium text-yellow-100 truncate" title={adata?.['POINT']}>{adata?.['POINT'] || '-'}</div></div>
                          <div><span className="block text-yellow-600/70 text-xs uppercase mb-1">Rank</span><div className="font-medium text-yellow-100">{adata?.['RANK'] || '-'}</div></div>
                          <div><span className="block text-yellow-600/70 text-xs uppercase mb-1">Total Fixed Due</span><div className="font-mono text-lg text-emerald-400">LKR {adata?.['TOTAL DUE'] || '-'}</div></div>
                          <div>
                            <span className="block text-yellow-600/70 text-xs uppercase mb-1">Total Shifts</span>
                            <div className="font-medium text-yellow-100 flex gap-2">
                              {adata?.['NO OF SHIFTS'] || 0}
                              <span className="text-xs text-yellow-500/50 flex items-center">({adata?.['NO OF DAY'] || 0} D, {adata?.['NO OF NIGHT'] || 0} N)</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="border-t border-yellow-500/10 pt-4 space-y-2">
                          <div className="flex justify-between"><span>Basic Salary</span><span>LKR {sd?.basicSalary || adata?.['BASIC SALARY ']}</span></div>
                          <div className="flex justify-between text-red-300"><span>8% EPF Deduction</span><span>- LKR {calc.epf8.toFixed(2)}</span></div>
                          <div className="flex justify-between text-red-300"><span>Food / Meal</span><span>- LKR {sd?.foodDeduction || adata?.['MEAL '] || 0}</span></div>
                          <div className="flex justify-between text-red-300"><span>No Pay</span><span>- LKR {sd?.noPayDeduction || adata?.['NO PAY'] || 0}</span></div>
                          <div className="flex justify-between text-red-300"><span>Uniform</span><span>- LKR {sd?.uniformsDeduction || adata?.['UNIFORM'] || 0}</span></div>
                          <div className="flex justify-between text-red-300"><span>Advance / Other</span><span>- LKR {(parseFloat(adata?.['ADVANCE']||0) || 0) + (parseFloat(adata?.['OTHER']||0) || 0)}</span></div>
                        </div>

                        <div className="border-t border-yellow-500/30 pt-3 pb-1 flex justify-between font-bold text-base text-yellow-400">
                          <span>Nett Salary</span>
                          <span>LKR {adata?.['NETT SALARY'] || calc.netPay.toFixed(2)}</span>
                        </div>

                        <div className="border-t border-yellow-500/10 pt-4 space-y-2 text-xs text-yellow-600/70">
                          <div className="flex justify-between"><span>12% EPF (Company Contribution)</span><span>LKR {calc.epf12.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span>3% ETF (Company Contribution)</span><span>LKR {calc.etf3.toFixed(2)}</span></div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/40 border-b border-yellow-500/20 text-xs uppercase tracking-wider text-yellow-600/80">
                      <th className="p-4 font-medium">Date</th>
                      <th className="p-4 font-medium">Employee</th>
                      <th className="p-4 font-medium">Time In</th>
                      <th className="p-4 font-medium">Time Out</th>
                      <th className="p-4 font-medium">Hours Worked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-yellow-500/10">
                    {filteredSummaryRecords.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-8 text-center text-yellow-600/50">
                          No summary records found matching your criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredSummaryRecords.map((record) => (
                        <tr key={`${record.userId}-${record.date}`} className="hover:bg-white/5 transition-colors">
                          <td className="p-4 text-yellow-100/80 text-sm">
                            {record.date}
                          </td>
                          <td className="p-4">
                            <div className="font-medium text-yellow-100 flex items-center gap-2">
                              {record.userName}
                            </div>
                            <div className="text-xs text-yellow-600/70 mt-0.5">{record.userId}</div>
                          </td>
                          <td className="p-4">
                            <div className="text-sm text-emerald-400">
                              {record.timeIn ? new Date(record.timeIn).toLocaleTimeString() : '-'}
                            </div>
                            {(record.inLat && record.inLng) && (
                              <div className="text-xs text-yellow-600/70 mt-0.5 flex items-center">
                                <MapPin className="w-3 h-3 mr-1" />
                                {record.inLat.toFixed(4)}, {record.inLng.toFixed(4)}
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="text-sm text-amber-400">
                              {record.timeOut ? new Date(record.timeOut).toLocaleTimeString() : '-'}
                            </div>
                            {(record.outLat && record.outLng) && (
                              <div className="text-xs text-yellow-600/70 mt-0.5 flex items-center">
                                <MapPin className="w-3 h-3 mr-1" />
                                {record.outLat.toFixed(4)}, {record.outLng.toFixed(4)}
                              </div>
                            )}
                          </td>
                          <td className="p-4">
                            {record.hoursWorked ? (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium border bg-yellow-950/50 text-yellow-400 border-yellow-500/30">
                                {record.hoursWorked} hrs
                              </span>
                            ) : (
                              <span className="text-sm text-yellow-600/50">Incomplete</span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : activeTab === 'users' && isAdmin ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="bg-black/60 backdrop-blur-md rounded-2xl shadow-xl border border-yellow-500/30 overflow-hidden">
              <div className="p-6 border-b border-yellow-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-xl font-semibold text-yellow-400 flex items-center">
                  <Users className="w-5 h-5 mr-2" />
                  User Management
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-yellow-500/5 text-yellow-600/80 text-xs uppercase tracking-wider border-b border-yellow-500/20">
                      <th className="p-4 font-medium">Email</th>
                      <th className="p-4 font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-yellow-500/10">
                    {users.length === 0 ? (
                      <tr>
                        <td colSpan={2} className="p-8 text-center text-yellow-600/50">
                          No users found.
                        </td>
                      </tr>
                    ) : (
                      users.map((user) => (
                        <tr key={user.id} className="hover:bg-white/5 transition-colors">
                          <td className="p-4">
                            <div className="font-medium text-yellow-100">{user.email}</div>
                          </td>
                          <td className="p-4">
                            <select
                              value={user.role}
                              onChange={(e) => handleUpdateRole(user.id, e.target.value)}
                              disabled={ADMIN_EMAILS.includes(user.email)}
                              className="w-full sm:w-auto bg-black/40 border border-yellow-500/30 text-yellow-100 text-sm rounded-lg focus:ring-yellow-500 focus:border-yellow-500 block p-2.5 disabled:opacity-50"
                            >
                              <option value="user">User</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>

    {/* Delete Single Record Modal */}
    {deleteConfirmId !== null && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-semibold text-yellow-400 mb-2">Delete Record</h3>
          <p className="text-yellow-100/80 mb-6">Are you sure you want to delete this attendance record? This action cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button 
              onClick={() => setDeleteConfirmId(null)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-yellow-100/80 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={() => handleDelete(deleteConfirmId)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Clear All Records Modal */}
    {showClearConfirm && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <div className="bg-zinc-900 border border-red-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl">
          <h3 className="text-xl font-semibold text-red-400 mb-2 flex items-center">
            <AlertCircle className="w-5 h-5 mr-2" />
            Clear All Records
          </h3>
          <p className="text-yellow-100/80 mb-6">Are you absolutely sure you want to delete <strong className="text-red-400">ALL</strong> attendance records? This action is permanent and cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button 
              onClick={() => setShowClearConfirm(false)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-yellow-100/80 hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleClearAll}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
            >
              Yes, Clear All
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
