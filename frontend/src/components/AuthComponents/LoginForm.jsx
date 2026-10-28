import { useState } from 'react';
import { Link } from 'react-router'; // Usa 'react-router-dom' se hai problemi con 'react-router'

export default function LoginForm({ onLogin }) {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    await onLogin(formData.email, formData.password);
    
    setLoading(false);
  };

  return (

    <div className="min-h-screen flex items-center justify-center bg-base-200 p-4">
      {/* Card coerente con quella di registrazione */}
      <div className="card w-full max-w-md bg-base-100 shadow-xl border border-base-300">
        <div className="card-body">
          <h2 className="card-title text-2xl font-bold text-center justify-center mb-1">
            Bentornato!
          </h2>
          <p className="text-sm text-center text-base-content/70 mb-4">
            Accedi al tuo account per continuare
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            
            {/* Campo Email */}
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium">Email</span>
              </label>
              <input 
                type="email" 
                placeholder="mario@example.com" 
                className="input input-bordered w-full focus:input-primary"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                required
              />
            </div>

            {/* Campo Password */}
            <div className="form-control">
              <label className="label py-1">
                <span className="label-text font-medium">Password</span>
              </label>
              <input 
                type="password" 
                placeholder="••••••••" 
                className="input input-bordered w-full focus:input-primary"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
                required
              />
            </div>

            {/* Bottone di Invio */}
            <button 
              type="submit" 
              className="btn btn-primary w-full mt-2"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner loading-xs"></span>
                  Accesso in corso...
                </>
              ) : (
                'Accedi'
              )}
            </button>
          </form>

          {/* Divisore e Link alla Registrazione */}
          <div className="divider text-sm mt-6">oppure</div>
          
          <div className="text-center text-sm">
            <span className="text-base-content/70">Non hai un account? </span>
            <Link to="/register" className="link link-primary font-semibold">
              Registrati ora
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}