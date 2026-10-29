import './App.css';
import { Routes, Route, useNavigate } from 'react-router';
import LoginForm from './components/AuthComponents/LoginForm';
import RegisterForm from './components/AuthComponents/RegistrationForm';
import { useEffect, useState } from 'react';
import authAPI from './api/auth_api'; // Assicurati che il nome del file coincida
import { Homepage } from './pages/Homepage';
import { Layout } from './pages/Layout';
import { ReservationPage } from './pages/ReservationPage';

export const App = () => {
  const [user, setUser] = useState(undefined);
  const [loggedIn, setLoggedIn] = useState(false);
  const [message, setMessage] = useState(null);
  
  const navigate = useNavigate(); // to redirect the user

  // checks session
  useEffect(() => {
    const checkSession = async () => {
      try {
        
        const currentUser = await authAPI.getCurrentUser(); 
        if (currentUser) {
          setUser(currentUser);
          setLoggedIn(true);
        }
      } catch {
        setLoggedIn(false);
        setUser(undefined);
      }
    }
    checkSession();
  }, []);

  // 2. Timer per far svanire i messaggi di errore/successo
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 3000); // Aumentato a 3 secondi per dare tempo di leggere
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Handler for login
  const handleLogin = async (email, password) => {
    try {
      const loggedUser = await authAPI.login(email, password);
      setLoggedIn(true);
      setUser(loggedUser);
      setMessage({ msg: "Login effettuato con successo!", type: "success" });
      navigate("/"); // Goes back to the homepage after the login
    } catch (err) {
      setMessage({ msg: err.message || "Email o password errate. Riprova.", type: "error" });
    }
  }

  // handler for registration
  const handleRegister = async (name, email, phone, password) => {
    try {
      const newUser = await authAPI.register(name, email, phone, password);
      setLoggedIn(true);
      setUser(newUser);
      setMessage({ msg: "Registrazione completata!", type: "success" });
      navigate("/"); // goes back to homepage
    } catch (err) {
      setMessage({ msg: err.message || "Errore durante la registrazione.", type: "error" });
    }
  }

  // 5. Handler for Logout
  const handleLogout = async () => {
    try {
      await authAPI.logout();
      setLoggedIn(false);
      setUser(undefined);
      setMessage({ msg: "Logout effettuato.", type: "info" });
      navigate("/"); // redirects to homepage after logout 
    } catch {
      setMessage({ msg: "Logout non riuscito. Riprova.", type: "error" });
    }
  }

  return (
    <>
      
      {message && (
        <div className="toast toast-top toast-center z-50">
          <div className={`alert alert-${message.type}`}>
            <span>{message.msg}</span>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={ <Homepage />} />
          <Route path="/reservations" element={ loggedIn ? <ReservationPage/> : "Log in first"} />
          <Route path="*" element={<p> Not Found </p>} />
        </Route>
        
        <Route 
          path="/login" 
          element={<LoginForm onLogin={handleLogin} />} 
        />
        <Route 
          path="/register" 
          element={<RegisterForm onRegister={handleRegister} />} 
        />
      </Routes>
    </>
  );
}