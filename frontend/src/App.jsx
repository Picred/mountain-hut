import './App.css';
import { Routes, Route, useNavigate } from 'react-router';
import LoginForm from './components/AuthComponents/LoginForm';
import RegisterForm from './components/AuthComponents/RegistrationForm';
import { useEffect, useState } from 'react';
import authAPI from './api/auth_api'; // Assicurati che il nome del file coincida

export const App = () => {
  const [user, setUser] = useState(undefined);
  const [loggedIn, setLoggedIn] = useState(false);
  const [message, setMessage] = useState(null);
  
  const navigate = useNavigate(); // Per reindirizzare l'utente

  // Controlla la sessione all'avvio
  useEffect(() => {
    const checkSession = async () => {
      try {
        // Usa il nome della funzione che hai definito nel tuo authAPI (getSession o getCurrentUser)
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

  // Handler per il Login
  const handleLogin = async (email, password) => {
    try {
      const loggedUser = await authAPI.login(email, password);
      setLoggedIn(true);
      setUser(loggedUser);
      setMessage({ msg: "Login effettuato con successo!", type: "success" });
      navigate("/"); // Torna alla home dopo il login
    } catch (err) {
      setMessage({ msg: err.message || "Email o password errate. Riprova.", type: "error" });
    }
  }

  // Handler per la Registrazione (Mancava nel tuo codice)
  const handleRegister = async (name, email, phone, password) => {
    try {
      const newUser = await authAPI.register(name, email, phone, password);
      setLoggedIn(true);
      setUser(newUser);
      setMessage({ msg: "Registrazione completata!", type: "success" });
      navigate("/"); // Torna alla home
    } catch (err) {
      setMessage({ msg: err.message || "Errore durante la registrazione.", type: "error" });
    }
  }

  // 5. Handler per il Logout
  const handleLogout = async () => {
    try {
      await authAPI.logout();
      setLoggedIn(false);
      setUser(undefined);
      setMessage({ msg: "Logout effettuato.", type: "info" });
      navigate("/login"); // Reindirizza al login dopo essere usciti
    } catch {
      setMessage({ msg: "Logout non riuscito. Riprova.", type: "error" });
    }
  }

  return (
    <>
      {/* Banner Globale per i messaggi (opzionale, sfrutta DaisyUI) */}
      {message && (
        <div className="toast toast-top toast-center z-50">
          <div className={`alert alert-${message.type}`}>
            <span>{message.msg}</span>
          </div>
        </div>
      )}

      <Routes>
        <Route path="/" element={<p> Layout (Utente Loggato: {loggedIn ? user?.name : 'No'}) </p>}>
          <Route index element={<p> Homepage </p>} />
          <Route path="*" element={<p> Not Found </p>} />
        </Route>
        
        {/* Passiamo le funzioni e gli stati come props ai componenti */}
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